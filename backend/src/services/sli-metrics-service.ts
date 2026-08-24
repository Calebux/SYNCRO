import { supabase, databaseRepository } from '../config/database';
import logger from '../config/logger';
import { notificationQueue } from '../jobs/notification-queue';

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
  /** Timestamp when metrics were calculated (ISO-8601) */
  calculated_at: string;
}

export class SliMetricsService {
  /**
   * Fetch core SLI metrics snapshot.
   */
  async getSliMetrics(): Promise<SliMetrics> {
    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const [
      renewalMetrics,
      webhookLagMetrics,
      queueDepthMetrics,
      dlqMetrics,
    ] = await Promise.all([
      this.fetchRenewalSuccessRate(since24h),
      this.fetchWebhookProcessingLag(since24h),
      this.fetchNotificationQueueDepth(),
      this.fetchDeadLetterCounts(since24h),
    ]);

    return {
      renewal_success_rate_pct: renewalMetrics,
      webhook_processing_lag_ms: webhookLagMetrics,
      notification_queue_depth: queueDepthMetrics,
      dead_letter_counts: dlqMetrics,
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
    ];

    return lines.join('\n');
  }

  private async fetchRenewalSuccessRate(since: string): Promise<number> {
    try {
      const { data, error } = await databaseRepository
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
      const { data, error } = await databaseRepository
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
        databaseRepository
          .from('notification_dead_letter_queue')
          .select('id', { count: 'exact', head: true })
          .gte('dead_letter_at', since),
        databaseRepository
          .from('renewal_dead_letter_queue')
          .select('id', { count: 'exact', head: true })
          .gte('dead_letter_at', since),
        databaseRepository
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
}

export const sliMetricsService = new SliMetricsService();
