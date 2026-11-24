/**
 * Tracks background job failures and emits Sentry alerts when thresholds breach.
 * See docs/JOB_FAILURE_RUNBOOK.md for operator response procedures.
 */

import * as Sentry from '@sentry/node';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { env } from '../config/env';
import {
  evaluateJobThresholds,
  getCriticalJobById,
  getCriticalJobConfigs,
  resolveSentryLevel,
  type JobFailureMetrics,
  type TriggeredJobAlert,
} from '../config/job-alert-config';

const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const ALERT_COOLDOWN_MS =
  parseInt(env.JOB_ALERT_COOLDOWN_MS, 10);

interface JobRuntimeState {
  consecutiveFailures: number;
  failureTimestamps: number[];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

export class JobAlertService {
  private runtime = new Map<string, JobRuntimeState>();
  private lastEmittedAt = new Map<string, number>();
  private externalMetrics = new Map<string, Partial<JobFailureMetrics>>();
  private dlqCache: { notificationDlq24h: number; webhookDlq24h: number; fetchedAt: number } | null =
    null;

  /** Inject metrics from external sources (e.g. EventListener health). */
  setExternalMetrics(jobId: string, metrics: Partial<JobFailureMetrics>): void {
    this.externalMetrics.set(jobId, metrics);
  }

  /** Record a job execution outcome (success resets consecutive failure count). */
  recordJobOutcome(jobId: string, success: boolean, error?: unknown): void {
    const state = this.getOrCreateState(jobId);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    if (success) {
      state.consecutiveFailures = 0;
      state.lastSuccessAt = nowIso;
      state.lastError = null;
      return;
    }

    state.consecutiveFailures += 1;
    state.failureTimestamps.push(now);
    state.failureTimestamps = state.failureTimestamps.filter(
      (ts) => now - ts <= HOURLY_WINDOW_MS,
    );
    state.lastFailureAt = nowIso;
    state.lastError = error instanceof Error ? error.message : String(error ?? 'unknown error');

    logger.error('Background job failure recorded', {
      jobId,
      consecutiveFailures: state.consecutiveFailures,
      failuresPerHour: state.failureTimestamps.length,
      error: state.lastError,
    });

    this.evaluateAndEmitForJob(jobId).catch((err) => {
      logger.error('Failed to evaluate job alerts after failure', { jobId, err });
    });
  }

  /** Evaluate all critical jobs and return triggered alerts (without emitting). */
  async evaluateAllJobAlerts(): Promise<TriggeredJobAlert[]> {
    const dlqCounts = await this.fetchDlqCounts();
    const alerts: TriggeredJobAlert[] = [];

    for (const job of getCriticalJobConfigs()) {
      const metrics = this.buildMetrics(job.id, dlqCounts);
      alerts.push(...evaluateJobThresholds(job, metrics));
    }

    return alerts;
  }

  /** Periodic check: evaluate all jobs and emit Sentry alerts for new breaches. */
  async checkAndEmitAlerts(): Promise<TriggeredJobAlert[]> {
    const alerts = await this.evaluateAllJobAlerts();
    for (const alert of alerts) {
      this.emitAlert(alert);
    }
    return alerts;
  }

  getRuntimeMetrics(jobId: string): JobFailureMetrics {
    const state = this.getOrCreateState(jobId);
    return {
      consecutiveFailures: state.consecutiveFailures,
      failuresPerHour: state.failureTimestamps.length,
    };
  }

  /** Wrap a cron handler with failure tracking. */
  async runMonitoredJob<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      this.recordJobOutcome(jobId, true);
      return result;
    } catch (error) {
      this.recordJobOutcome(jobId, false, error);
      throw error;
    }
  }

  resetForTests(): void {
    this.runtime.clear();
    this.lastEmittedAt.clear();
    this.externalMetrics.clear();
    this.dlqCache = null;
  }

  private getOrCreateState(jobId: string): JobRuntimeState {
    let state = this.runtime.get(jobId);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        failureTimestamps: [],
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
      };
      this.runtime.set(jobId, state);
    }
    return state;
  }

  private async evaluateAndEmitForJob(jobId: string): Promise<void> {
    const job = getCriticalJobById(jobId);
    if (!job) return;

    const dlqCounts = await this.fetchDlqCounts();
    const metrics = this.buildMetrics(jobId, dlqCounts);
    const alerts = evaluateJobThresholds(job, metrics);
    for (const alert of alerts) {
      this.emitAlert(alert);
    }
  }

  private buildMetrics(
    jobId: string,
    dlqCounts: { notificationDlq24h: number; webhookDlq24h: number },
  ): JobFailureMetrics {
    const runtime = this.getRuntimeMetrics(jobId);
    const external = this.externalMetrics.get(jobId) ?? {};
    const metrics: JobFailureMetrics = {
      consecutiveFailures: external.consecutiveFailures ?? runtime.consecutiveFailures,
      failuresPerHour: external.failuresPerHour ?? runtime.failuresPerHour,
    };

    if (jobId === 'notification-queue' || jobId === 'reminder-retries' || jobId === 'reminder-processing') {
      metrics.dlqCount24h = dlqCounts.notificationDlq24h;
    }
    if (jobId === 'webhook-retries') {
      metrics.dlqCount24h = dlqCounts.webhookDlq24h;
    }

    return metrics;
  }

  private async fetchDlqCounts(): Promise<{ notificationDlq24h: number; webhookDlq24h: number }> {
    const now = Date.now();
    if (this.dlqCache && now - this.dlqCache.fetchedAt < 60_000) {
      return this.dlqCache;
    }

    const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const [notificationRes, webhookRes] = await Promise.all([
      supabase
        .from('notification_dead_letter_queue')
        .select('id', { count: 'exact', head: true })
        .gte('dead_letter_at', since),
      supabase
        .from('webhook_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('is_dead_letter', true)
        .gte('dead_letter_at', since),
    ]);

    const counts = {
      notificationDlq24h: notificationRes.count ?? 0,
      webhookDlq24h: webhookRes.count ?? 0,
      fetchedAt: now,
    };
    this.dlqCache = counts;
    return counts;
  }

  private emitAlert(alert: TriggeredJobAlert): void {
    const dedupeKey = `${alert.jobId}:${alert.metric}:${alert.level}`;
    const lastEmitted = this.lastEmittedAt.get(dedupeKey) ?? 0;
    if (Date.now() - lastEmitted < ALERT_COOLDOWN_MS) {
      return;
    }
    this.lastEmittedAt.set(dedupeKey, Date.now());

    const sentryLevel = resolveSentryLevel(alert.pagingSeverity, alert.level);

    Sentry.captureMessage(alert.message, {
      level: sentryLevel,
      tags: {
        alert_type: 'job_failure',
        job_id: alert.jobId,
        paging_severity: alert.pagingSeverity,
        alert_level: alert.level,
        job_critical: String(alert.critical),
      },
      contexts: {
        job_alert: {
          job_name: alert.jobName,
          metric: alert.metric,
          value: alert.value,
          threshold: alert.threshold,
          runbook_section: alert.runbookSection,
          runbook: alert.runbook,
        },
      },
    });

    logger.warn('Job alert threshold breached', {
      jobId: alert.jobId,
      level: alert.level,
      pagingSeverity: alert.pagingSeverity,
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold,
      runbookSection: alert.runbookSection,
      runbook: alert.runbook,
    });
  }
}

export const jobAlertService = new JobAlertService();
