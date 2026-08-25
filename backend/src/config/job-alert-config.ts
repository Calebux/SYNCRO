/**
 * Alert thresholds and paging severity for critical background jobs.
 *
 * Thresholds can be overridden per job via environment variables:
 *   JOB_ALERT_<ENV_PREFIX>_CONSECUTIVE_FAILURES_WARNING
 *   JOB_ALERT_<ENV_PREFIX>_CONSECUTIVE_FAILURES_CRITICAL
 *   JOB_ALERT_<ENV_PREFIX>_FAILURES_PER_HOUR_WARNING
 *   JOB_ALERT_<ENV_PREFIX>_FAILURES_PER_HOUR_CRITICAL
 *   JOB_ALERT_<ENV_PREFIX>_DLQ_COUNT_24H_WARNING
 *   JOB_ALERT_<ENV_PREFIX>_DLQ_COUNT_24H_CRITICAL
 *
 * Runbook: docs/JOB_FAILURE_RUNBOOK.md
 */

export type PagingSeverity = 'page' | 'alert' | 'warn';

export type AlertLevel = 'warning' | 'critical';

export interface JobFailureThresholds {
  /** Consecutive cron/worker execution failures before alerting */
  consecutiveFailures?: number;
  /** Failures recorded within a rolling 1-hour window */
  failuresPerHour?: number;
  /** Dead-letter queue entries created in the last 24 hours */
  dlqCount24h?: number;
}

export interface CriticalJobConfig {
  id: string;
  name: string;
  description: string;
  /** When true, breaches escalate to the paging severity below */
  critical: boolean;
  /** page = P1 on-call, alert = P2 ticket, warn = P3 monitor-only */
  pagingSeverity: PagingSeverity;
  /** Used to build JOB_ALERT_<ENV_PREFIX>_* env var names */
  envPrefix: string;
  thresholds: {
    warning: JobFailureThresholds;
    critical: JobFailureThresholds;
  };
  /** Anchor in docs/JOB_FAILURE_RUNBOOK.md */
  runbookSection: string;
  /** Direct path to ops runbook */
  runbook: string;
}

const DEFAULT_JOBS: CriticalJobConfig[] = [
  {
    id: 'reminder-processing',
    name: 'Reminder Processing',
    description: 'Daily cron that delivers pending subscription reminders',
    critical: true,
    pagingSeverity: 'page',
    envPrefix: 'REMINDER_PROCESSING',
    thresholds: {
      warning: { consecutiveFailures: 1, failuresPerHour: 5 },
      critical: { consecutiveFailures: 2, failuresPerHour: 15, dlqCount24h: 10 },
    },
    runbookSection: 'reminder-processing',
    runbook: 'docs/ops/reminder-processing-runbook.md',
  },
  {
    id: 'reminder-scheduling',
    name: 'Reminder Scheduling',
    description: 'Daily cron that schedules upcoming reminder deliveries',
    critical: true,
    pagingSeverity: 'page',
    envPrefix: 'REMINDER_SCHEDULING',
    thresholds: {
      warning: { consecutiveFailures: 1 },
      critical: { consecutiveFailures: 2, failuresPerHour: 5 },
    },
    runbookSection: 'reminder-scheduling',
    runbook: 'docs/ops/reminder-scheduling-runbook.md',
  },
  {
    id: 'reminder-retries',
    name: 'Reminder Retries',
    description: 'Every-30-min cron that retries failed notification deliveries',
    critical: true,
    pagingSeverity: 'page',
    envPrefix: 'REMINDER_RETRIES',
    thresholds: {
      warning: { consecutiveFailures: 2, failuresPerHour: 10, dlqCount24h: 10 },
      critical: { consecutiveFailures: 3, failuresPerHour: 25, dlqCount24h: 50 },
    },
    runbookSection: 'reminder-retries',
    runbook: 'docs/ops/reminder-retries-runbook.md',
  },
  {
    id: 'notification-queue',
    name: 'Notification Queue Worker',
    description: 'BullMQ worker for push/SMS notification delivery',
    critical: true,
    pagingSeverity: 'page',
    envPrefix: 'NOTIFICATION_QUEUE',
    thresholds: {
      warning: { failuresPerHour: 20, dlqCount24h: 5 },
      critical: { failuresPerHour: 50, dlqCount24h: 15 },
    },
    runbookSection: 'notification-queue',
    runbook: 'docs/ops/notification-queue-runbook.md',
  },
  {
    id: 'event-listener',
    name: 'Blockchain Event Listener',
    description: 'Polls Soroban contract events for renewal state sync',
    critical: true,
    pagingSeverity: 'page',
    envPrefix: 'EVENT_LISTENER',
    thresholds: {
      warning: { consecutiveFailures: 5, failuresPerHour: 10 },
      critical: { consecutiveFailures: 10, failuresPerHour: 30 },
    },
    runbookSection: 'event-listener',
    runbook: 'docs/ops/event-listener-runbook.md',
  },
  {
    id: 'expiry-processing',
    name: 'Subscription Expiry Processing',
    description: 'Daily cron that marks expired subscriptions and triggers cleanup',
    critical: true,
    pagingSeverity: 'alert',
    envPrefix: 'EXPIRY_PROCESSING',
    thresholds: {
      warning: { consecutiveFailures: 1 },
      critical: { consecutiveFailures: 2, failuresPerHour: 3 },
    },
    runbookSection: 'expiry-processing',
    runbook: 'docs/ops/expiry-processing-runbook.md',
  },
  {
    id: 'auto-resume',
    name: 'Auto-Resume Subscriptions',
    description: 'Daily cron that resumes paused subscriptions past resume_at',
    critical: true,
    pagingSeverity: 'alert',
    envPrefix: 'AUTO_RESUME',
    thresholds: {
      warning: { consecutiveFailures: 1, failuresPerHour: 3 },
      critical: { consecutiveFailures: 2, failuresPerHour: 10 },
    },
    runbookSection: 'auto-resume',
    runbook: 'docs/ops/auto-resume-runbook.md',
  },
  {
    id: 'webhook-retries',
    name: 'Webhook Retry Processing',
    description: 'Every-5-min cron that retries failed outbound webhook deliveries',
    critical: false,
    pagingSeverity: 'alert',
    envPrefix: 'WEBHOOK_RETRIES',
    thresholds: {
      warning: { consecutiveFailures: 3, dlqCount24h: 10 },
      critical: { consecutiveFailures: 5, dlqCount24h: 25 },
    },
    runbookSection: 'webhook-retries',
    runbook: 'docs/ops/webhook-retries-runbook.md',
  },
  {
    id: 'csp-monitoring',
    name: 'CSP Monitoring Jobs',
    description: 'Cron jobs that refresh CSP stats and evaluate violation alerts',
    critical: false,
    pagingSeverity: 'warn',
    envPrefix: 'CSP_MONITORING',
    thresholds: {
      warning: { consecutiveFailures: 2 },
      critical: { consecutiveFailures: 4, failuresPerHour: 3 },
    },
    runbookSection: 'csp-monitoring',
    runbook: 'docs/ops/csp-monitoring-runbook.md',
  },
];

function parseEnvInt(name: string, fallback: number | undefined): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const METRIC_ENV_SUFFIX: Record<keyof JobFailureThresholds, string> = {
  consecutiveFailures: 'CONSECUTIVE_FAILURES',
  failuresPerHour: 'FAILURES_PER_HOUR',
  dlqCount24h: 'DLQ_COUNT_24H',
};

function resolveThresholds(
  envPrefix: string,
  defaults: { warning: JobFailureThresholds; critical: JobFailureThresholds },
): { warning: JobFailureThresholds; critical: JobFailureThresholds } {
  const key = (level: 'WARNING' | 'CRITICAL', metric: keyof JobFailureThresholds) =>
    `JOB_ALERT_${envPrefix}_${METRIC_ENV_SUFFIX[metric]}_${level}`;

  const resolveLevel = (
    level: 'WARNING' | 'CRITICAL',
    base: JobFailureThresholds,
  ): JobFailureThresholds => ({
    consecutiveFailures: parseEnvInt(
      key(level, 'consecutiveFailures'),
      base.consecutiveFailures,
    ),
    failuresPerHour: parseEnvInt(key(level, 'failuresPerHour'), base.failuresPerHour),
    dlqCount24h: parseEnvInt(key(level, 'dlqCount24h'), base.dlqCount24h),
  });

  return {
    warning: resolveLevel('WARNING', defaults.warning),
    critical: resolveLevel('CRITICAL', defaults.critical),
  };
}

/** All registered critical job definitions with env overrides applied */
export function getCriticalJobConfigs(): CriticalJobConfig[] {
  return DEFAULT_JOBS.map((job) => ({
    ...job,
    thresholds: resolveThresholds(job.envPrefix, job.thresholds),
  }));
}

export function getCriticalJobById(jobId: string): CriticalJobConfig | undefined {
  return getCriticalJobConfigs().find((job) => job.id === jobId);
}

export interface JobFailureMetrics {
  consecutiveFailures: number;
  failuresPerHour: number;
  dlqCount24h?: number;
}

export interface TriggeredJobAlert {
  jobId: string;
  jobName: string;
  level: AlertLevel;
  pagingSeverity: PagingSeverity;
  critical: boolean;
  runbookSection: string;
  runbook: string;
  message: string;
  metric: keyof JobFailureThresholds;
  value: number;
  threshold: number;
  triggeredAt: string;
}

function thresholdBreached(
  value: number,
  threshold: number | undefined,
): threshold is number {
  return threshold !== undefined && value >= threshold;
}

/**
 * Evaluate job metrics against warning/critical thresholds.
 * Returns the highest-severity alert per metric (critical wins over warning).
 */
export function evaluateJobThresholds(
  job: CriticalJobConfig,
  metrics: JobFailureMetrics,
  now: string = new Date().toISOString(),
): TriggeredJobAlert[] {
  const alerts: TriggeredJobAlert[] = [];
  const metricKeys: (keyof JobFailureThresholds)[] = [
    'consecutiveFailures',
    'failuresPerHour',
    'dlqCount24h',
  ];

  for (const metric of metricKeys) {
    const value =
      metric === 'consecutiveFailures'
        ? metrics.consecutiveFailures
        : metric === 'failuresPerHour'
          ? metrics.failuresPerHour
          : (metrics.dlqCount24h ?? 0);

    if (value === 0 && metric === 'dlqCount24h' && metrics.dlqCount24h === undefined) {
      continue;
    }

    const criticalThreshold = job.thresholds.critical[metric];
    const warningThreshold = job.thresholds.warning[metric];

    if (thresholdBreached(value, criticalThreshold)) {
      alerts.push({
        jobId: job.id,
        jobName: job.name,
        level: 'critical',
        pagingSeverity: job.pagingSeverity,
        critical: job.critical,
        runbookSection: job.runbookSection,
        runbook: job.runbook,
        message: `${job.name}: ${metric} (${value}) reached critical threshold (${criticalThreshold})`,
        metric,
        value,
        threshold: criticalThreshold,
        triggeredAt: now,
      });
    } else if (thresholdBreached(value, warningThreshold)) {
      alerts.push({
        jobId: job.id,
        jobName: job.name,
        level: 'warning',
        pagingSeverity: job.pagingSeverity,
        critical: job.critical,
        runbookSection: job.runbookSection,
        runbook: job.runbook,
        message: `${job.name}: ${metric} (${value}) reached warning threshold (${warningThreshold})`,
        metric,
        value,
        threshold: warningThreshold,
        triggeredAt: now,
      });
    }
  }

  return alerts;
}

/** Sentry severity derived from paging severity and alert level */
export function resolveSentryLevel(
  pagingSeverity: PagingSeverity,
  level: AlertLevel,
): 'fatal' | 'error' | 'warning' | 'info' {
  if (pagingSeverity === 'page' && level === 'critical') return 'error';
  if (pagingSeverity === 'page' && level === 'warning') return 'warning';
  if (pagingSeverity === 'alert' && level === 'critical') return 'error';
  if (pagingSeverity === 'alert') return 'warning';
  return level === 'critical' ? 'warning' : 'info';
}
