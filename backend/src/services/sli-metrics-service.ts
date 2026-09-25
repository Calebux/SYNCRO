import { supabase } from '../config/database';
import logger from '../config/logger';
import { notificationQueue } from '../jobs/notification-queue';
import { settlementReconciliationService } from './settlement-reconciliation-service';

// ─── Types ──────────────────────────────────────────────────────────

export interface AdmissionLatencyByStepMs {
  identityResolutionMs: { p50: number; p95: number; p99: number };
  scopeReadMs: { p50: number; p95: number; p99: number };
  capCheckMs: { p50: number; p95: number; p99: number };
  meterReserveMs: { p50: number; p95: number; p99: number };
}

export interface AdmissionRejectionsByReason {
  unauthenticated: number;
  missing_scope: number;
  cap_exceeded: number;
  invalid_payment_proof: number;
  meter_reserve_failed: number;
  upstream_error: number;
  total: number;
}

export interface MeterRates {
  reserveSuccessRatePct: number;
  commitSuccessRatePct: number;
  reserveFailures: number;
  commitFailures: number;
  totalReserves: number;
  totalCommits: number;
}

export interface UnsettledValuePerChannel {
  channelId: string;
  userId: string;
  unsettledValue: number;
  lastSettledAt: string | null;
  channelAgeHours: number;
}

export interface SettlementSubmissionMetrics {
  submissionSuccessRatePct: number;
  totalSubmissions: number;
  successfulSubmissions: number;
  failedSubmissions: number;
}

export interface IndexerLagMs {
  latestLedger: number;
  latestProcessedLedger: number;
  lagMs: number;
  lagBlocks: number;
}

export interface ReconciliationDelta {
  totalDelta: number;
  channelsOutOfTolerance: number;
  deltasByCause: Record<string, number>;
  blocked: boolean;
}

export interface PaidCallMetrics {
  admission_latency_by_step_ms: AdmissionLatencyByStepMs;
  admission_rejections_by_reason: AdmissionRejectionsByReason;
  meter_reserve_and_commit: MeterRates;
  unsettled_value_per_channel: UnsettledValuePerChannel[];
  settlement_submission: SettlementSubmissionMetrics;
  indexer_lag_ms: IndexerLagMs;
  reconciliation_delta: ReconciliationDelta;
}

export interface SliMetrics {
  /** Renewal success rate percentage (0 - 100) over the rolling 24h window */
  renewal_success_rate_pct: number;
  /** Webhook processing lag in milliseconds (average and p95 over 24h) */
  webhook_processing_lag_ms: {
    avg_ms: number;
    p95_ms: number;
  };
  /** Notification queue depth (active + waiting + delayed jobs) */
  notification_queue_depth: {
    total: number;
    active: number;
    waiting: number;
    delayed: number;
    failed: number;
  };
  /** Dead-letter counts broken down by pipeline (24h window) */
  dead_letter_counts: {
    notification_dlq_24h: number;
    renewal_dlq_24h: number;
    webhook_dlq_24h: number;
    total_dlq_24h: number;
  };
  /** Paid-call path metrics (admission, metering, settlement, indexer, reconciliation) */
  paid_call_metrics: PaidCallMetrics;
  /** Timestamp when metrics were calculated (ISO-8601) */
  calculated_at: string;
}

export class SliMetricsService {
  /**
   * Fetch core SLI metrics snapshot including paid-call path metrics.
   */
  async getSliMetrics(): Promise<SliMetrics> {
    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const [
      renewalMetrics,
      webhookLagMetrics,
      queueDepthMetrics,
      dlqMetrics,
      paidCallMetrics,
    ] = await Promise.all([
      this.fetchRenewalSuccessRate(since24h),
      this.fetchWebhookProcessingLag(since24h),
      this.fetchNotificationQueueDepth(),
      this.fetchDeadLetterCounts(since24h),
      this.fetchPaidCallMetrics(),
    ]);

    return {
      renewal_success_rate_pct: renewalMetrics,
      webhook_processing_lag_ms: webhookLagMetrics,
      notification_queue_depth: queueDepthMetrics,
      dead_letter_counts: dlqMetrics,
      paid_call_metrics: paidCallMetrics,
      calculated_at: new Date(now).toISOString(),
    };
  }

  /**
   * Format SLI metrics as standard Prometheus exposition text (`text/plain; version=0.0.4`).
   */
  async formatPrometheusMetrics(): Promise<string> {
    const sli = await this.getSliMetrics();

    const lines: string[] = [
      '# HELP syncro_renewal_success_rate_pct Percentage of successful subscription renewal executions (24h window)',
      '# TYPE syncro_renewal_success_rate_pct gauge',
      `syncro_renewal_success_rate_pct ${sli.renewal_success_rate_pct}`,
      '',
      '# HELP syncro_webhook_processing_lag_ms Webhook delivery processing lag in milliseconds (24h window)',
      '# TYPE syncro_webhook_processing_lag_ms gauge',
      `syncro_webhook_processing_lag_ms{quantile="avg"} ${sli.webhook_processing_lag_ms.avg_ms}`,
      `syncro_webhook_processing_lag_ms{quantile="p95"} ${sli.webhook_processing_lag_ms.p95_ms}`,
      '',
      '# HELP syncro_notification_queue_depth Current job depth in notification queue by state',
      '# TYPE syncro_notification_queue_depth gauge',
      `syncro_notification_queue_depth{state="total"} ${sli.notification_queue_depth.total}`,
      `syncro_notification_queue_depth{state="active"} ${sli.notification_queue_depth.active}`,
      `syncro_notification_queue_depth{state="waiting"} ${sli.notification_queue_depth.waiting}`,
      `syncro_notification_queue_depth{state="delayed"} ${sli.notification_queue_depth.delayed}`,
      `syncro_notification_queue_depth{state="failed"} ${sli.notification_queue_depth.failed}`,
      '',
      '# HELP syncro_dead_letter_count Dead-letter queue item counts by pipeline (24h window)',
      '# TYPE syncro_dead_letter_count gauge',
      `syncro_dead_letter_count{pipeline="notification"} ${sli.dead_letter_counts.notification_dlq_24h}`,
      `syncro_dead_letter_count{pipeline="renewal"} ${sli.dead_letter_counts.renewal_dlq_24h}`,
      `syncro_dead_letter_count{pipeline="webhook"} ${sli.dead_letter_counts.webhook_dlq_24h}`,
      `syncro_dead_letter_count{pipeline="total"} ${sli.dead_letter_counts.total_dlq_24h}`,
      '',
      // ── Paid-call path metrics ──────────────────────────────────────────
      '# HELP syncro_admission_latency_by_step_ms Admission latency in milliseconds by step (p50/p95/p99)',
      '# TYPE syncro_admission_latency_by_step_ms gauge',
      `syncro_admission_latency_by_step_ms{step="identity_resolution",quantile="p50"} ${sli.paid_call_metrics.admission_latency_by_step_ms.identityResolutionMs.p50}`,
      `syncro_admission_latency_by_step_ms{step="identity_resolution",quantile="p95"} ${sli.paid_call_metrics.admission_latency_by_step_ms.identityResolutionMs.p95}`,
      `syncro_admission_latency_by_step_ms{step="identity_resolution",quantile="p99"} ${sli.paid_call_metrics.admission_latency_by_step_ms.identityResolutionMs.p99}`,
      `syncro_admission_latency_by_step_ms{step="scope_read",quantile="p50"} ${sli.paid_call_metrics.admission_latency_by_step_ms.scopeReadMs.p50}`,
      `syncro_admission_latency_by_step_ms{step="scope_read",quantile="p95"} ${sli.paid_call_metrics.admission_latency_by_step_ms.scopeReadMs.p95}`,
      `syncro_admission_latency_by_step_ms{step="scope_read",quantile="p99"} ${sli.paid_call_metrics.admission_latency_by_step_ms.scopeReadMs.p99}`,
      `syncro_admission_latency_by_step_ms{step="cap_check",quantile="p50"} ${sli.paid_call_metrics.admission_latency_by_step_ms.capCheckMs.p50}`,
      `syncro_admission_latency_by_step_ms{step="cap_check",quantile="p95"} ${sli.paid_call_metrics.admission_latency_by_step_ms.capCheckMs.p95}`,
      `syncro_admission_latency_by_step_ms{step="cap_check",quantile="p99"} ${sli.paid_call_metrics.admission_latency_by_step_ms.capCheckMs.p99}`,
      `syncro_admission_latency_by_step_ms{step="meter_reserve",quantile="p50"} ${sli.paid_call_metrics.admission_latency_by_step_ms.meterReserveMs.p50}`,
      `syncro_admission_latency_by_step_ms{step="meter_reserve",quantile="p95"} ${sli.paid_call_metrics.admission_latency_by_step_ms.meterReserveMs.p95}`,
      `syncro_admission_latency_by_step_ms{step="meter_reserve",quantile="p99"} ${sli.paid_call_metrics.admission_latency_by_step_ms.meterReserveMs.p99}`,
      '',
      '# HELP syncro_admission_rejections_total Admission rejections by reason (24h window)',
      '# TYPE syncro_admission_rejections_total counter',
      `syncro_admission_rejections_total{reason="unauthenticated"} ${sli.paid_call_metrics.admission_rejections_by_reason.unauthenticated}`,
      `syncro_admission_rejections_total{reason="missing_scope"} ${sli.paid_call_metrics.admission_rejections_by_reason.missing_scope}`,
      `syncro_admission_rejections_total{reason="cap_exceeded"} ${sli.paid_call_metrics.admission_rejections_by_reason.cap_exceeded}`,
      `syncro_admission_rejections_total{reason="invalid_payment_proof"} ${sli.paid_call_metrics.admission_rejections_by_reason.invalid_payment_proof}`,
      `syncro_admission_rejections_total{reason="meter_reserve_failed"} ${sli.paid_call_metrics.admission_rejections_by_reason.meter_reserve_failed}`,
      `syncro_admission_rejections_total{reason="upstream_error"} ${sli.paid_call_metrics.admission_rejections_by_reason.upstream_error}`,
      `syncro_admission_rejections_total{reason="total"} ${sli.paid_call_metrics.admission_rejections_by_reason.total}`,
      '',
      '# HELP syncro_meter_reserve_success_rate_pct Meter reserve success rate percentage (24h window)',
      '# TYPE syncro_meter_reserve_success_rate_pct gauge',
      `syncro_meter_reserve_success_rate_pct ${sli.paid_call_metrics.meter_reserve_and_commit.reserveSuccessRatePct}`,
      '',
      '# HELP syncro_meter_commit_success_rate_pct Meter commit success rate percentage (24h window)',
      '# TYPE syncro_meter_commit_success_rate_pct gauge',
      `syncro_meter_commit_success_rate_pct ${sli.paid_call_metrics.meter_reserve_and_commit.commitSuccessRatePct}`,
      '',
      '# HELP syncro_meter_reserve_failures_total Meter reserve failures (24h window)',
      '# TYPE syncro_meter_reserve_failures_total counter',
      `syncro_meter_reserve_failures_total ${sli.paid_call_metrics.meter_reserve_and_commit.reserveFailures}`,
      '',
      '# HELP syncro_meter_commit_failures_total Meter commit failures (24h window)',
      '# TYPE syncro_meter_commit_failures_total counter',
      `syncro_meter_commit_failures_total ${sli.paid_call_metrics.meter_reserve_and_commit.commitFailures}`,
      '',
      '# HELP syncro_meter_total_reserves_total Total meter reserve attempts (24h window)',
      '# TYPE syncro_meter_total_reserves_total counter',
      `syncro_meter_total_reserves_total ${sli.paid_call_metrics.meter_reserve_and_commit.totalReserves}`,
      '',
      '# HELP syncro_meter_total_commits_total Total meter commit attempts (24h window)',
      '# TYPE syncro_meter_total_commits_total counter',
      `syncro_meter_total_commits_total ${sli.paid_call_metrics.meter_reserve_and_commit.totalCommits}`,
      '',
      '# HELP syncro_unsettled_value_per_channel Unsettled value (in cents) per active payment channel',
      '# TYPE syncro_unsettled_value_per_channel gauge',
      ...sli.paid_call_metrics.unsettled_value_per_channel.map(
        (c) => `syncro_unsettled_value_per_channel{channel_id="${c.channelId}",user_id="${c.userId}"} ${c.unsettledValue}`,
      ),
      '',
      '# HELP syncro_settlement_submission_success_rate_pct Settlement submission success rate percentage (24h window)',
      '# TYPE syncro_settlement_submission_success_rate_pct gauge',
      `syncro_settlement_submission_success_rate_pct ${sli.paid_call_metrics.settlement_submission.submissionSuccessRatePct}`,
      '',
      '# HELP syncro_indexer_lag_ms Indexer lag in milliseconds (difference between latest on-chain ledger and latest processed ledger)',
      '# TYPE syncro_indexer_lag_ms gauge',
      `syncro_indexer_lag_ms ${sli.paid_call_metrics.indexer_lag_ms.lagMs}`,
      '',
      '# HELP syncro_indexer_lag_blocks Indexer lag in blocks',
      '# TYPE syncro_indexer_lag_blocks gauge',
      `syncro_indexer_lag_blocks ${sli.paid_call_metrics.indexer_lag_ms.lagBlocks}`,
      '',
      '# HELP syncro_reconciliation_delta_total Total reconciliation delta across all channels',
      '# TYPE syncro_reconciliation_delta_total gauge',
      `syncro_reconciliation_delta_total ${sli.paid_call_metrics.reconciliation_delta.totalDelta}`,
      '',
      '# HELP syncro_reconciliation_channels_out_of_tolerance Number of channels with reconciliation delta outside tolerance',
      '# TYPE syncro_reconciliation_channels_out_of_tolerance gauge',
      `syncro_reconciliation_channels_out_of_tolerance ${sli.paid_call_metrics.reconciliation_delta.channelsOutOfTolerance}`,
      '',
      '# HELP syncro_reconciliation_blocked Whether settlement batching is currently blocked due to reconciliation delta',
      '# TYPE syncro_reconciliation_blocked gauge',
      `syncro_reconciliation_blocked ${sli.paid_call_metrics.reconciliation_delta.blocked ? 1 : 0}`,
      '',
    ];

    return lines.join('\n');
  }

  private async fetchRenewalSuccessRate(since: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('renewal_logs')
        .select('status')
        .gte('created_at', since)
        .limit(10000);

      if (error || !data || data.length === 0) {
        return 100.0;
      }

      const total = data.length;
      const successes = data.filter((r) => r.status === 'success' || r.status === 'confirmed').length;
      return parseFloat(((successes / total) * 100).toFixed(2));
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch renewal success rate', { err });
      return 100.0;
    }
  }

  private async fetchWebhookProcessingLag(since: string): Promise<{ avg_ms: number; p95_ms: number }> {
    try {
      const { data, error } = await supabase
        .from('webhook_deliveries')
        .select('created_at, delivered_at, updated_at')
        .gte('created_at', since)
        .limit(10000);

      if (error || !data || data.length === 0) {
        return { avg_ms: 0, p95_ms: 0 };
      }

      const lags = data
        .map((d) => {
          const finishedAt = d.delivered_at || d.updated_at;
          if (!finishedAt) return null;
          const diff = new Date(finishedAt).getTime() - new Date(d.created_at).getTime();
          return diff >= 0 ? diff : null;
        })
        .filter((val): val is number => val !== null)
        .sort((a, b) => a - b);

      if (lags.length === 0) {
        return { avg_ms: 0, p95_ms: 0 };
      }

      const sum = lags.reduce((acc, l) => acc + l, 0);
      const avg = Math.round(sum / lags.length);
      const p95Idx = Math.min(Math.ceil(0.95 * lags.length) - 1, lags.length - 1);
      const p95 = lags[Math.max(0, p95Idx)];

      return { avg_ms: avg, p95_ms: p95 };
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch webhook processing lag', { err });
      return { avg_ms: 0, p95_ms: 0 };
    }
  }

  private async fetchNotificationQueueDepth(): Promise<{
    total: number;
    active: number;
    waiting: number;
    delayed: number;
    failed: number;
  }> {
    try {
      const counts = await notificationQueue.getJobCounts(
        'active',
        'waiting',
        'delayed',
        'failed',
      );

      const active = counts.active ?? 0;
      const waiting = counts.waiting ?? 0;
      const delayed = counts.delayed ?? 0;
      const failed = counts.failed ?? 0;

      return {
        total: active + waiting + delayed,
        active,
        waiting,
        delayed,
        failed,
      };
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch notification queue depth', { err });
      return { total: 0, active: 0, waiting: 0, delayed: 0, failed: 0 };
    }
  }

  private async fetchDeadLetterCounts(since: string): Promise<{
    notification_dlq_24h: number;
    renewal_dlq_24h: number;
    webhook_dlq_24h: number;
    total_dlq_24h: number;
  }> {
    try {
      const [notificationRes, renewalRes, webhookRes] = await Promise.all([
        supabase
          .from('notification_dead_letter_queue')
          .select('id', { count: 'exact', head: true })
          .gte('dead_letter_at', since),
        supabase
          .from('renewal_dead_letter_queue')
          .select('id', { count: 'exact', head: true })
          .gte('dead_letter_at', since),
        supabase
          .from('webhook_deliveries')
          .select('id', { count: 'exact', head: true })
          .eq('is_dead_letter', true)
          .gte('dead_letter_at', since),
      ]);

      const notification_dlq_24h = notificationRes.count ?? 0;
      const renewal_dlq_24h = renewalRes.count ?? 0;
      const webhook_dlq_24h = webhookRes.count ?? 0;

      return {
        notification_dlq_24h,
        renewal_dlq_24h,
        webhook_dlq_24h,
        total_dlq_24h: notification_dlq_24h + renewal_dlq_24h + webhook_dlq_24h,
      };
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch dead-letter counts', { err });
      return { notification_dlq_24h: 0, renewal_dlq_24h: 0, webhook_dlq_24h: 0, total_dlq_24h: 0 };
    }
  }

  // ── Paid-call path metrics ──────────────────────────────────

  private async fetchPaidCallMetrics(): Promise<PaidCallMetrics> {
    const [
      admissionLatency,
      admissionRejections,
      meterRates,
      unsettledValue,
      settlementSubmission,
      indexerLag,
      reconciliationDelta,
    ] = await Promise.all([
      this.fetchAdmissionLatency(),
      this.fetchAdmissionRejections(),
      this.fetchMeterRates(),
      this.fetchUnsettledValuePerChannel(),
      this.fetchSettlementSubmissionMetrics(),
      this.fetchIndexerLag(),
      this.fetchReconciliationDelta(),
    ]);

    return {
      admission_latency_by_step_ms: admissionLatency,
      admission_rejections_by_reason: admissionRejections,
      meter_reserve_and_commit: meterRates,
      unsettled_value_per_channel: unsettledValue,
      settlement_submission: settlementSubmission,
      indexer_lag_ms: indexerLag,
      reconciliation_delta: reconciliationDelta,
    };
  }

  private async fetchAdmissionLatency(): Promise<AdmissionLatencyByStepMs> {
    try {
      const { data, error } = await supabase
        .from('admission_latency_log')
        .select('step, latency_ms')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(10000);

      if (error || !data || data.length === 0) {
        return this.emptyAdmissionLatency();
      }

      const byStep: Record<string, number[]> = {
        identityResolutionMs: [],
        scopeReadMs: [],
        capCheckMs: [],
        meterReserveMs: [],
      };

      for (const row of data) {
        const step = row.step as keyof AdmissionLatencyByStepMs;
        if (byStep[step]) {
          byStep[step].push(row.latency_ms);
        }
      }

      const p50 = (arr: number[]) => this.percentile(arr, 50);
      const p95 = (arr: number[]) => this.percentile(arr, 95);
      const p99 = (arr: number[]) => this.percentile(arr, 99);

      return {
        identityResolutionMs: { p50: p50(byStep.identityResolutionMs), p95: p95(byStep.identityResolutionMs), p99: p99(byStep.identityResolutionMs) },
        scopeReadMs: { p50: p50(byStep.scopeReadMs), p95: p95(byStep.scopeReadMs), p99: p99(byStep.scopeReadMs) },
        capCheckMs: { p50: p50(byStep.capCheckMs), p95: p95(byStep.capCheckMs), p99: p99(byStep.capCheckMs) },
        meterReserveMs: { p50: p50(byStep.meterReserveMs), p95: p95(byStep.meterReserveMs), p99: p99(byStep.meterReserveMs) },
      };
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch admission latency', { err });
      return this.emptyAdmissionLatency();
    }
  }

  private async fetchAdmissionRejections(): Promise<AdmissionRejectionsByReason> {
    try {
      const { data, error } = await supabase
        .from('admission_rejection_log')
        .select('reason')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(10000);

      if (error || !data || data.length === 0) {
        return { unauthenticated: 0, missing_scope: 0, cap_exceeded: 0, invalid_payment_proof: 0, meter_reserve_failed: 0, upstream_error: 0, total: 0 };
      }

      const counts: AdmissionRejectionsByReason = {
        unauthenticated: 0,
        missing_scope: 0,
        cap_exceeded: 0,
        invalid_payment_proof: 0,
        meter_reserve_failed: 0,
        upstream_error: 0,
        total: data.length,
      };

      for (const row of data) {
        const reason = row.reason as keyof AdmissionRejectionsByReason;
        if (reason in counts) {
          counts[reason]++;
        }
      }

      return counts;
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch admission rejections', { err });
      return { unauthenticated: 0, missing_scope: 0, cap_exceeded: 0, invalid_payment_proof: 0, meter_reserve_failed: 0, upstream_error: 0, total: 0 };
    }
  }

  private async fetchMeterRates(): Promise<MeterRates> {
    try {
      const { data, error } = await supabase
        .from('meter_operations_log')
        .select('operation, success')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(10000);

      if (error || !data || data.length === 0) {
        return { reserveSuccessRatePct: 100, commitSuccessRatePct: 100, reserveFailures: 0, commitFailures: 0, totalReserves: 0, totalCommits: 0 };
      }

      const reserves = data.filter((r) => r.operation === 'reserve');
      const commits = data.filter((r) => r.operation === 'commit');

      const reserveSuccesses = reserves.filter((r) => r.success).length;
      const commitSuccesses = commits.filter((r) => r.success).length;

      const reserveSuccessRatePct = reserves.length > 0 ? parseFloat(((reserveSuccesses / reserves.length) * 100).toFixed(2)) : 100;
      const commitSuccessRatePct = commits.length > 0 ? parseFloat(((commitSuccesses / commits.length) * 100).toFixed(2)) : 100;

      return {
        reserveSuccessRatePct,
        commitSuccessRatePct,
        reserveFailures: reserves.length - reserveSuccesses,
        commitFailures: commits.length - commitSuccesses,
        totalReserves: reserves.length,
        totalCommits: commits.length,
      };
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch meter rates', { err });
      return { reserveSuccessRatePct: 100, commitSuccessRatePct: 100, reserveFailures: 0, commitFailures: 0, totalReserves: 0, totalCommits: 0 };
    }
  }

  private async fetchUnsettledValuePerChannel(): Promise<UnsettledValuePerChannel[]> {
    try {
      const { data, error } = await supabase
        .from('payment_channels')
        .select('id, user_id, balance, state, created_at, last_settled_at')
        .in('state', ['active', 'closing'])
        .limit(100);

      if (error || !data || data.length === 0) {
        return [];
      }

      const now = Date.now();
      return data.map((c) => {
        const balance = Number(c.balance ?? 0);
        const createdAt = new Date(c.created_at).getTime();
        const lastSettled = c.last_settled_at ? new Date(c.last_settled_at).getTime() : null;
        const channelAgeHours = (now - createdAt) / 3_600_000;
        const lastSettledAt = c.last_settled_at ?? null;

        return {
          channelId: c.id,
          userId: c.user_id,
          unsettledValue: balance,
          lastSettledAt: lastSettledAt,
          channelAgeHours: Math.round(channelAgeHours * 100) / 100,
        };
      });
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch unsettled value per channel', { err });
      return [];
    }
  }

  private async fetchSettlementSubmissionMetrics(): Promise<SettlementSubmissionMetrics> {
    try {
      const { data, error } = await supabase
        .from('settlement_submissions')
        .select('success')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(10000);

      if (error || !data || data.length === 0) {
        return { submissionSuccessRatePct: 100, totalSubmissions: 0, successfulSubmissions: 0, failedSubmissions: 0 };
      }

      const total = data.length;
      const successful = data.filter((s) => s.success).length;
      const failed = total - successful;
      const submissionSuccessRatePct = total > 0 ? parseFloat(((successful / total) * 100).toFixed(2)) : 100;

      return { submissionSuccessRatePct, totalSubmissions: total, successfulSubmissions: successful, failedSubmissions: failed };
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch settlement submission metrics', { err });
      return { submissionSuccessRatePct: 100, totalSubmissions: 0, successfulSubmissions: 0, failedSubmissions: 0 };
    }
  }

  private async fetchIndexerLag(): Promise<IndexerLagMs> {
    try {
      // Get the latest on-chain ledger from the blockchain_logs table
      const { data: latestOnChain, error: onChainError } = await supabase
        .from('blockchain_logs')
        .select('ledger')
        .order('ledger', { ascending: false })
        .limit(1)
        .single();

      if (onChainError || !latestOnChain) {
        return { latestLedger: 0, latestProcessedLedger: 0, lagMs: 0, lagBlocks: 0 };
      }

      // Get the latest processed ledger from the indexer cursor
      const { data: cursorData, error: cursorError } = await supabase
        .from('indexer_cursor')
        .select('ledger')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (cursorError || !cursorData) {
        return { latestLedger: latestOnChain.ledger, latestProcessedLedger: 0, lagMs: 0, lagBlocks: 0 };
      }

      const latestLedger = latestOnChain.ledger;
      const latestProcessedLedger = cursorData.ledger;
      const lagBlocks = Math.max(0, latestLedger - latestProcessedLedger);

      // Approximate lag in ms: assume ~5s per Stellar ledger
      const lagMs = lagBlocks * 5000;

      return { latestLedger, latestProcessedLedger, lagMs, lagBlocks };
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch indexer lag', { err });
      return { latestLedger: 0, latestProcessedLedger: 0, lagMs: 0, lagBlocks: 0 };
    }
  }

  private async fetchReconciliationDelta(): Promise<ReconciliationDelta> {
    try {
      const result = await settlementReconciliationService.getLatestReconciliation();
      return {
        totalDelta: result.totalDelta,
        channelsOutOfTolerance: result.channelsOutOfTolerance,
        deltasByCause: result.deltasByCause,
        blocked: result.blocked,
      };
    } catch (err) {
      logger.error('[SliMetrics] Failed to fetch reconciliation delta', { err });
      return { totalDelta: 0, channelsOutOfTolerance: 0, deltasByCause: {}, blocked: false };
    }
  }

  private emptyAdmissionLatency(): AdmissionLatencyByStepMs {
    return {
      identityResolutionMs: { p50: 0, p95: 0, p99: 0 },
      scopeReadMs: { p50: 0, p95: 0, p99: 0 },
      capCheckMs: { p50: 0, p95: 0, p99: 0 },
      meterReserveMs: { p50: 0, p95: 0, p99: 0 },
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }
}

export const sliMetricsService = new SliMetricsService();
