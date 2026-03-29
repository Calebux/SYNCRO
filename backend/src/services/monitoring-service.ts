import { supabase } from '../config/database';
import logger from '../config/logger';

export interface SubscriptionMetrics {
    total_subscriptions: number;
    active_subscriptions: number;
    category_distribution: Record<string, number>;
    total_monthly_revenue: number;
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

export class MonitoringService {
    /**
     * Helper to time a query and log its execution time.
     */
    private async timeQuery<T>(name: string, query: Promise<T>): Promise<T> {
        const start = Date.now();
        try {
            const result = await query;
            logger.info(`Monitoring Query: ${name} took ${Date.now() - start}ms`);
            return result;
        } catch (error) {
            logger.error(`Monitoring Query: ${name} failed after ${Date.now() - start}ms`, error);
            throw error;
        }
    }

    /**
     * Get subscription metrics
     */
    async getSubscriptionMetrics(): Promise<SubscriptionMetrics> {
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
                            let monthlyPrice = sub.price;
                            if (sub.billing_cycle === 'yearly') monthlyPrice = sub.price / 12;
                            else if (sub.billing_cycle === 'weekly') monthlyPrice = sub.price * 4;
                            metrics.total_monthly_revenue += monthlyPrice;
                        }
                    }
                }
                return metrics;
            }

            return data as SubscriptionMetrics;
        })());
    }

    /**
     * Get renewal metrics based on notification deliveries
     */
    async getRenewalMetrics(): Promise<RenewalMetrics> {
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
        })());
    }

    /**
     * Get agent activity summary
     */
    async getAgentActivity(): Promise<AgentActivity> {
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
        })());
    }
}

export const monitoringService = new MonitoringService();
