import { supabase, monitorPool, PoolMetrics } from '../config/database';
import logger from '../config/logger';
import { ExternalServiceClient, ServiceMetrics } from '../utils/external-service-client';
import { apiLatencyService, EndpointLatencyMetrics } from './api-latency-service';
import { redisDistributedLock, LockMetricsSnapshot } from '../lib/redis-lock';
import { renewalDeadLetterService } from './renewal-dead-letter-service';
import { queryCacheService, QueryCacheMetrics } from './query-cache-service';
import { normalizeToMonthlyAmount } from '@syncro/shared/subscription-math';

// ─── Existing interfaces ────────────────────────────────────────────────────

export interface SubscriptionMetrics {
    total_subscriptions: number;
    active_subscriptions: number;
    category_distribution: Record<string, number>;
    total_monthly_revenue: number;
}

export interface TrialMetrics {
    active_trials: number;
    trials_expiring_in_7_days: number;
    saved_by_syncro: number;       // trials cancelled before auto-charge after receiving a reminder
    intentional_conversions: number;
    automatic_conversions: number;
}

export interface RenewalMetrics {
    total_delivery_attempts: number;
    success_rate: number;
    failure_rate: number;
    channel_distribution: Record<string, { success: number; failure: number }>;
}

export interface AgentActivity {
    pending_reminders: number;
    processed_reminders_last_24h: number;
    confirmed_blockchain_events: number;
    failed_blockchain_events: number;
}

// ─── New interfaces (Issue #99) ──────────────────────────────────────────────

export interface ThroughputMetrics {
    /** Duration of the measurement window in hours. */
    window_hours: number;
    /** Timestamp (ISO-8601) marking the start of the window. */
    window_start: string;
    /** Number of reminder schedules moved to sent/failed in the window. */
    reminders_processed: number;
    /** Number of notification_deliveries created in the window (all channels). */
    notification_deliveries_total: number;
    /** Notification deliveries broken down by channel. */
    deliveries_by_channel: Record<string, number>;
    /** Number of renewal_logs entries created in the window. */
    renewals_executed: number;
    /** Renewal executions broken down by status (success / failed). */
    renewals_by_status: Record<string, number>;
    /** Number of blockchain_log entries created in the window. */
    blockchain_events: number;
}

export interface LatencyPercentiles {
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    avg_ms: number;
    sample_count: number;
}

export interface LatencyMetrics {
    window_hours: number;
    window_start: string;
    /** Latency from delivery creation to last_attempt_at (notification pipeline). */
    notification_delivery_latency: LatencyPercentiles;
    /** Latency from renewal_log creation to its updated_at (renewal pipeline). */
    renewal_execution_latency: LatencyPercentiles;
}

export interface RetryMetrics {
    window_hours: number;
    window_start: string;
    /** Total deliveries that were retried at least once. */
    total_retried: number;
    /** Deliveries that exhausted all retry attempts. */
    max_retries_hit: number;
    /** Percentage of failed deliveries that triggered retries. */
    retry_rate_pct: number;
    /** attempt_count → number of deliveries that ended at that count. */
    attempt_distribution: Record<number, number>;
    /** Per-channel retry breakdown. */
    retries_by_channel: Record<string, { retried: number; max_hit: number }>;
}

export interface FailedItem {
    id: string;
    type: 'reminder' | 'renewal' | 'blockchain';
    status: string;
    failure_reason?: string;
    error_message?: string;
    subscription_id?: string;
    user_id?: string;
    channel?: string;
    attempt_count?: number;
    created_at: string;
    updated_at?: string;
}

export interface FailedItemsResult {
    type: 'reminder' | 'renewal' | 'blockchain';
    total: number;
    limit: number;
    offset: number;
    items: FailedItem[];
}

export interface RenewalLockMetrics {
    redis_locks: LockMetricsSnapshot;
    dead_letter: {
        total: number;
        last_24h: number;
        last_7d: number;
    };
    generated_at: string;
}

// ─── Service class ───────────────────────────────────────────────────────────

export class MonitoringService {
    /**
     * Helper to time a query and log its execution time.
     */
    private async timeQuery<T>(name: string, query: Promise<T>, contextId?: string): Promise<T> {
        const start = Date.now();
        const meta = contextId ? { requestId: contextId } : {};
        try {
            const result = await query;
            logger.info(`Monitoring Query: ${name} took ${Date.now() - start}ms`, meta);
            return result;
        } catch (error) {
            logger.error(`Monitoring Query: ${name} failed after ${Date.now() - start}ms`, { ...meta, error });
            throw error;
        }
    }

    /**
     * Compute an ISO-8601 timestamp for `windowHours` ago.
     */
    private windowStart(windowHours: number): string {
        return new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
    }

    /**
     * Compute percentiles from a sorted array of numbers.
     */
    private computePercentiles(sorted: number[]): LatencyPercentiles {
        if (sorted.length === 0) {
            return { p50_ms: 0, p95_ms: 0, p99_ms: 0, avg_ms: 0, sample_count: 0 };
        }
        const at = (pct: number) => {
            const idx = Math.min(Math.ceil((pct / 100) * sorted.length) - 1, sorted.length - 1);
            return sorted[Math.max(0, idx)];
        };
        const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
        return {
            p50_ms: at(50),
            p95_ms: at(95),
            p99_ms: at(99),
            avg_ms: Math.round(avg),
            sample_count: sorted.length,
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Existing methods (unchanged)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Get subscription metrics
     */
    async getSubscriptionMetrics(contextId?: string): Promise<SubscriptionMetrics> {
        return this.timeQuery('getSubscriptionMetrics', (async () => {
            // Use RPC for efficiency on large tables
            const { data, error } = await supabase.rpc('get_subscription_metrics');

            if (error) {
                // Fallback for cases where RPC is not defined or fails
                logger.warn('fallback to manual counting for subscription metrics as RPC failed');
                const [
                    { count: totalCount },
                    { count: activeCount },
                    // Limit raw fetch for metrics that can't be computed with simple counts
                    { data: subs }
                ] = await Promise.all([
                    supabase.from('subscriptions').select('*', { count: 'exact', head: true }),
                    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
                    supabase.from('subscriptions').select('category, price, status, billing_cycle').limit(10000)
                ]);

                const metrics: SubscriptionMetrics = {
                    total_subscriptions: totalCount || 0,
                    active_subscriptions: activeCount || 0,
                    category_distribution: {},
                    total_monthly_revenue: 0,
                };

                if (subs) {
                    for (const sub of subs) {
                        metrics.category_distribution[sub.category] = (metrics.category_distribution[sub.category] || 0) + 1;
                        if (sub.status === 'active') {
                            metrics.total_monthly_revenue += normalizeToMonthlyAmount(sub.price, sub.billing_cycle);
                        }
                    }
                }
                return metrics;
            }

            return data as SubscriptionMetrics;
        })(), contextId);
    }

    /**
     * Get renewal metrics based on notification deliveries
     */
    async getRenewalMetrics(contextId?: string): Promise<RenewalMetrics> {
        return this.timeQuery('getRenewalMetrics', (async () => {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            
            // Limit to last 24h of deliveries and cap the result set
            const { data: deliveries, error } = await supabase
                .from('notification_deliveries')
                .select('channel, status')
                .gte('created_at', yesterday)
                .limit(5000);

            if (error) throw error;

            const metrics: RenewalMetrics = {
                total_delivery_attempts: deliveries.length,
                success_rate: 0,
                failure_rate: 0,
                channel_distribution: {},
            };

            if (deliveries.length === 0) return metrics;

            let successes = 0;
            let failures = 0;

            for (const d of deliveries) {
                if (!metrics.channel_distribution[d.channel]) {
                    metrics.channel_distribution[d.channel] = { success: 0, failure: 0 };
                }

                if (d.status === 'sent') {
                    successes++;
                    metrics.channel_distribution[d.channel].success++;
                } else if (d.status === 'failed') {
                    failures++;
                    metrics.channel_distribution[d.channel].failure++;
                }
            }

            metrics.success_rate = (successes / deliveries.length) * 100;
            metrics.failure_rate = (failures / deliveries.length) * 100;

            return metrics;
        })(), contextId);
    }

    /**
     * Get agent activity summary
     */
    async getAgentActivity(contextId?: string): Promise<AgentActivity> {
        return this.timeQuery('getAgentActivity', (async () => {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

            const [
                { count: pendingCount },
                { count: processedCount },
                { data: bcLogs }
            ] = await Promise.all([
                supabase.from('reminder_schedules').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
                supabase.from('reminder_schedules').select('*', { count: 'exact', head: true }).neq('status', 'pending').gte('updated_at', yesterday),
                // Optimized log query with limit and date filter
                supabase.from('blockchain_logs')
                    .select('status, created_at')
                    .gte('created_at', yesterday)
                    .order('created_at', { ascending: false })
                    .limit(1000)
            ]);

            return {
                pending_reminders: pendingCount || 0,
                processed_reminders_last_24h: processedCount || 0,
                confirmed_blockchain_events: bcLogs?.filter((l: any) => l.status === 'confirmed').length || 0,
                failed_blockchain_events: bcLogs?.filter((l: any) => l.status === 'failed').length || 0,
            };
        })(), contextId);
    }

    /**
     * Get trial-specific metrics including "saved by SYNCRO" count
     */
    async getTrialMetrics(contextId?: string): Promise<TrialMetrics> {
      try {
        const now = new Date().toISOString();
        const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const [
          { count: activeTrials },
          { count: expiringTrials },
          { data: conversionEvents },
        ] = await Promise.all([
          supabase
            .from('subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('is_trial', true)
            .in('status', ['active', 'trial'])
            .gt('trial_ends_at', now),
          supabase
            .from('subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('is_trial', true)
            .in('status', ['active', 'trial'])
            .gt('trial_ends_at', now)
            .lte('trial_ends_at', in7Days),
          supabase
            .from('trial_conversion_events')
            .select('conversion_type, saved_by_syncro'),
        ]);

        const events = conversionEvents ?? [];

        return {
          active_trials: activeTrials ?? 0,
          trials_expiring_in_7_days: expiringTrials ?? 0,
          saved_by_syncro: events.filter((e) => e.saved_by_syncro).length,
          intentional_conversions: events.filter((e) => e.conversion_type === 'intentional').length,
          automatic_conversions: events.filter((e) => e.conversion_type === 'automatic').length,
        };
      } catch (error) {
        logger.error('Error fetching trial metrics:', { requestId: contextId, error });
        throw error;
      }
    }

    /** Returns current DB connection pool metrics. */
    getPoolMetrics(): PoolMetrics {
        return monitorPool();
    }

    /**
     * Get metrics for all external service dependencies.
     */
    getExternalServiceMetrics(): Record<string, ServiceMetrics> {
        return ExternalServiceClient.getAllMetrics();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // New methods — Issue #99
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Get throughput metrics: number of items processed across all async pipelines
     * within the given time window.
     *
     * @param windowHours - Look-back window in hours (default 24)
     * @param contextId   - Optional request ID for log correlation
     */
    async getThroughputMetrics(windowHours = 24, contextId?: string): Promise<ThroughputMetrics> {
        return this.timeQuery('getThroughputMetrics', (async () => {
            const since = this.windowStart(windowHours);

            const [
                { data: reminders, error: rErr },
                { data: deliveries, error: dErr },
                { data: renewals, error: rnErr },
                { data: bcEvents, error: bcErr },
            ] = await Promise.all([
                supabase
                    .from('reminder_schedules')
                    .select('status')
                    .in('status', ['sent', 'failed'])
                    .gte('updated_at', since)
                    .limit(10000),
                supabase
                    .from('notification_deliveries')
                    .select('channel, status')
                    .gte('created_at', since)
                    .limit(10000),
                supabase
                    .from('renewal_logs')
                    .select('status')
                    .gte('created_at', since)
                    .limit(10000),
                supabase
                    .from('blockchain_logs')
                    .select('status')
                    .gte('created_at', since)
                    .limit(10000),
            ]);

            if (rErr) throw rErr;
            if (dErr) throw dErr;
            if (rnErr) throw rnErr;
            if (bcErr) throw bcErr;

            // Deliveries by channel
            const deliveriesByChannel: Record<string, number> = {};
            for (const d of deliveries ?? []) {
                deliveriesByChannel[d.channel] = (deliveriesByChannel[d.channel] ?? 0) + 1;
            }

            // Renewals by status
            const renewalsByStatus: Record<string, number> = {};
            for (const r of renewals ?? []) {
                renewalsByStatus[r.status] = (renewalsByStatus[r.status] ?? 0) + 1;
            }

            return {
                window_hours: windowHours,
                window_start: since,
                reminders_processed: (reminders ?? []).length,
                notification_deliveries_total: (deliveries ?? []).length,
                deliveries_by_channel: deliveriesByChannel,
                renewals_executed: (renewals ?? []).length,
                renewals_by_status: renewalsByStatus,
                blockchain_events: (bcEvents ?? []).length,
            } satisfies ThroughputMetrics;
        })(), contextId);
    }

    /**
     * Get p50 / p95 / p99 processing latency for the notification delivery pipeline
     * and the renewal execution pipeline within the given time window.
     *
     * Latency is measured as:
     *   - Delivery:  last_attempt_at − created_at
     *   - Renewal:   updated_at − created_at
     *
     * @param windowHours - Look-back window in hours (default 24)
     * @param contextId   - Optional request ID for log correlation
     */
    async getLatencyMetrics(windowHours = 24, contextId?: string): Promise<LatencyMetrics> {
        return this.timeQuery('getLatencyMetrics', (async () => {
            const since = this.windowStart(windowHours);

            const [
                { data: deliveries, error: dErr },
                { data: renewals, error: rErr },
            ] = await Promise.all([
                supabase
                    .from('notification_deliveries')
                    .select('created_at, last_attempt_at')
                    .not('last_attempt_at', 'is', null)
                    .gte('created_at', since)
                    .limit(10000),
                supabase
                    .from('renewal_logs')
                    .select('created_at, updated_at')
                    .not('updated_at', 'is', null)
                    .gte('created_at', since)
                    .limit(10000),
            ]);

            if (dErr) throw dErr;
            if (rErr) throw rErr;

            // Compute delivery latencies
            const deliveryLatencies = ((deliveries ?? []) as Array<{ created_at: string; last_attempt_at: string }>)
                .map(d => new Date(d.last_attempt_at).getTime() - new Date(d.created_at).getTime())
                .filter(ms => ms >= 0)
                .sort((a, b) => a - b);

            // Compute renewal latencies
            const renewalLatencies = ((renewals ?? []) as Array<{ created_at: string; updated_at: string }>)
                .map(r => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime())
                .filter(ms => ms >= 0)
                .sort((a, b) => a - b);

            return {
                window_hours: windowHours,
                window_start: since,
                notification_delivery_latency: this.computePercentiles(deliveryLatencies),
                renewal_execution_latency: this.computePercentiles(renewalLatencies),
            } satisfies LatencyMetrics;
        })(), contextId);
    }

    /**
     * Get retry depth metrics: how many deliveries were retried, how many hit
     * max attempts, and the distribution of attempt counts per channel.
     *
     * @param windowHours      - Look-back window in hours (default 24)
     * @param maxRetryAttempts - Threshold for "max retries hit" (default 3, matching ReminderEngine)
     * @param contextId        - Optional request ID for log correlation
     */
    async getRetryMetrics(
        windowHours = 24,
        maxRetryAttempts = 3,
        contextId?: string,
    ): Promise<RetryMetrics> {
        return this.timeQuery('getRetryMetrics', (async () => {
            const since = this.windowStart(windowHours);

            const { data: deliveries, error } = await supabase
                .from('notification_deliveries')
                .select('channel, status, attempt_count')
                .gte('created_at', since)
                .limit(10000);

            if (error) throw error;

            const rows = (deliveries ?? []) as Array<{
                channel: string;
                status: string;
                attempt_count: number;
            }>;

            let totalRetried = 0;
            let maxRetriesHit = 0;
            let totalFailed = 0;
            const attemptDist: Record<number, number> = {};
            const byChannel: Record<string, { retried: number; max_hit: number }> = {};

            for (const d of rows) {
                const count = d.attempt_count ?? 0;
                attemptDist[count] = (attemptDist[count] ?? 0) + 1;

                if (!byChannel[d.channel]) {
                    byChannel[d.channel] = { retried: 0, max_hit: 0 };
                }

                if (count > 1) {
                    totalRetried++;
                    byChannel[d.channel].retried++;
                }

                if (count >= maxRetryAttempts) {
                    maxRetriesHit++;
                    byChannel[d.channel].max_hit++;
                }

                if (d.status === 'failed') {
                    totalFailed++;
                }
            }

            const retryRatePct = totalFailed > 0
                ? parseFloat(((totalRetried / totalFailed) * 100).toFixed(2))
                : 0;

            return {
                window_hours: windowHours,
                window_start: since,
                total_retried: totalRetried,
                max_retries_hit: maxRetriesHit,
                retry_rate_pct: retryRatePct,
                attempt_distribution: attemptDist,
                retries_by_channel: byChannel,
            } satisfies RetryMetrics;
        })(), contextId);
    }

    /**
     * Get a paginated list of failed items for operator drill-down.
     *
     * @param type      - Pipeline to inspect: 'reminder' | 'renewal' | 'blockchain'
     * @param limit     - Page size (max 100)
     * @param offset    - Pagination offset
     * @param contextId - Optional request ID for log correlation
     */
    async getFailedItems(
        type: 'reminder' | 'renewal' | 'blockchain',
        limit = 20,
        offset = 0,
        contextId?: string,
    ): Promise<FailedItemsResult> {
        const safeLimit = Math.min(limit, 100);

        return this.timeQuery('getFailedItems', (async () => {
            if (type === 'reminder') {
                // Failed notification deliveries
                const { data, error, count } = await supabase
                    .from('notification_deliveries')
                    .select(
                        'id, status, channel, attempt_count, error_message, created_at, updated_at, reminder_schedules!inner(subscription_id, user_id)',
                        { count: 'exact' },
                    )
                    .eq('status', 'failed')
                    .order('created_at', { ascending: false })
                    .range(offset, offset + safeLimit - 1);

                if (error) throw error;

                const items: FailedItem[] = (data ?? []).map((d: any) => ({
                    id: d.id,
                    type: 'reminder' as const,
                    status: d.status,
                    channel: d.channel,
                    attempt_count: d.attempt_count,
                    error_message: d.error_message,
                    subscription_id: d.reminder_schedules?.subscription_id,
                    user_id: d.reminder_schedules?.user_id,
                    created_at: d.created_at,
                    updated_at: d.updated_at,
                }));

                return { type, total: count ?? 0, limit: safeLimit, offset, items };

            } else if (type === 'renewal') {
                // Failed renewal executions
                const { data, error, count } = await supabase
                    .from('renewal_logs')
                    .select(
                        'id, status, failure_reason, error_message, subscription_id, user_id, created_at, updated_at',
                        { count: 'exact' },
                    )
                    .eq('status', 'failed')
                    .order('created_at', { ascending: false })
                    .range(offset, offset + safeLimit - 1);

                if (error) throw error;

                const items: FailedItem[] = (data ?? []).map((d: any) => ({
                    id: d.id,
                    type: 'renewal' as const,
                    status: d.status,
                    failure_reason: d.failure_reason,
                    error_message: d.error_message,
                    subscription_id: d.subscription_id,
                    user_id: d.user_id,
                    created_at: d.created_at,
                    updated_at: d.updated_at,
                }));

                return { type, total: count ?? 0, limit: safeLimit, offset, items };

            } else {
                // Failed blockchain events
                const { data, error, count } = await supabase
                    .from('blockchain_logs')
                    .select(
                        'id, status, error_message, subscription_id, user_id, created_at',
                        { count: 'exact' },
                    )
                    .eq('status', 'failed')
                    .order('created_at', { ascending: false })
                    .range(offset, offset + safeLimit - 1);

                if (error) throw error;

                const items: FailedItem[] = (data ?? []).map((d: any) => ({
                    id: d.id,
                    type: 'blockchain' as const,
                    status: d.status,
                    error_message: d.error_message,
                    subscription_id: d.subscription_id,
                    user_id: d.user_id,
                    created_at: d.created_at,
                }));

                return { type, total: count ?? 0, limit: safeLimit, offset, items };
            }
        })(), contextId);
    }

    /**
     * Get API latency percentiles per endpoint family.
     */
    async getApiLatencyMetrics(): Promise<EndpointLatencyMetrics[]> {
        return apiLatencyService.getLatencyMetrics();
    }

    /**
     * Renewal distributed-lock metrics for the ops dashboard (Issue #962).
     */
    async getRenewalLockMetrics(): Promise<RenewalLockMetrics> {
        const [redisLocks, deadLetter] = await Promise.all([
            redisDistributedLock.getMetrics(),
            renewalDeadLetterService.getDeadLetterStats(),
        ]);

        return {
            redis_locks: redisLocks,
            dead_letter: deadLetter,
            generated_at: new Date().toISOString(),
        };
    }

    /**
     * Query cache hit/miss metrics (Issue #941).
     */
    async getQueryCacheMetrics(): Promise<QueryCacheMetrics & { hit_rate_pct: number }> {
        const metrics = await queryCacheService.getMetrics();
        const total = metrics.hits + metrics.misses;
        const hitRate = total > 0 ? parseFloat(((metrics.hits / total) * 100).toFixed(2)) : 0;

        return {
            ...metrics,
            hit_rate_pct: hitRate,
        };
    }
}

export const monitoringService = new MonitoringService();
