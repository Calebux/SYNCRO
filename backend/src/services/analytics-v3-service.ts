import { supabase } from '../config/database';
import logger from '../config/logger';
import {
  PrincipalAnalytics,
  OperatorAnalytics,
  AnalyticsPeriod,
  CapUtilization,
  RouteMixEntry,
  RejectionCategory,
  RejectionReason,
  PrincipalMetric,
} from '@syncro/shared/domain';

/** Default period: last 30 days */
const DEFAULT_GRANULARITY: AnalyticsPeriod['granularity'] = 'day';

/**
 * V3 Analytics Service — metrics around usage and settlement.
 *
 * Replaces the subscription-centric analytics with channel/usage-centric
 * metrics: calls metered, value settled/unsettled, active channels, cap
 * utilization, route mix, and rejection reasons.
 *
 * All queries are scoped to the requesting principal's userId to prevent
 * cross-tenant leakage. Operator endpoints aggregate across all principals
 * and are gated by the RBAC middleware before reaching this service.
 *
 * Data sources:
 *  - v3_analytics_calls_metered  → per-user daily metered call counts
 *  - v3_analytics_settlements    → per-user daily settled/unsettled values
 *  - v3_analytics_active_channels → per-user active channel counts
 *  - v3_analytics_rejections     → per-user daily rejection reasons by category
 *  - payment_channels            → global cap utilization (operator)
 *  - channel_payments            → global route mix (operator)
 *  - pending_settlements         → global value settled/unsettled (operator)
 */
export class AnalyticsV3Service {
  /**
   * Get principal-facing analytics scoped to a single user.
   *
   * The userId is taken from the authenticated request — it is never
   * derived from query parameters, so one principal cannot read another's
   * data even if they manipulate request parameters.
   */
  async getPrincipalAnalytics(
    userId: string,
    period: AnalyticsPeriod = this.defaultPeriod()
  ): Promise<PrincipalAnalytics> {
    const [
      callsMetered,
      valueSettled,
      valueUnsettled,
      activeChannels,
      capUtilization,
      routeMix,
      rejectionReasons,
    ] = await Promise.all([
      this.countMeteredCalls(userId, period),
      this.sumSettledValue(userId, period),
      this.sumUnsettledValue(userId, period),
      this.countActiveChannels(userId),
      this.getCapUtilization(userId),
      this.getRouteMix(userId, period),
      this.getRejectionReasons(userId, period),
    ]);

    return {
      callsMetered,
      valueSettled,
      valueUnsettled,
      activeChannels,
      capUtilizationPerAgent: capUtilization,
      routeMix,
      rejectionReasonsByCategory: rejectionReasons,
      period,
    };
  }

  /**
   * Get operator-facing analytics across all principals.
   *
   * This should only be called after RBAC validation (owner/admin).
   * Returns aggregate metrics plus top-principal breakdowns.
   */
  async getOperatorAnalytics(
    period: AnalyticsPeriod = this.defaultPeriod()
  ): Promise<OperatorAnalytics> {
    const [
      totalCallsMetered,
      totalValueSettled,
      totalValueUnsettled,
      totalActiveChannels,
      aggregateCapUtilization,
      globalRouteMix,
      globalRejectionReasons,
      topPrincipalsByCalls,
      topPrincipalsByValueSettled,
    ] = await Promise.all([
      this.countAllMeteredCalls(period),
      this.sumAllSettledValue(period),
      this.sumAllUnsettledValue(period),
      this.countAllActiveChannels(),
      this.getAllCapUtilization(),
      this.getAllRouteMix(period),
      this.getAllRejectionReasons(period),
      this.getTopPrincipalsByCalls(period),
      this.getTopPrincipalsByValueSettled(period),
    ]);

    return {
      totalCallsMetered,
      totalValueSettled,
      totalValueUnsettled,
      totalActiveChannels,
      aggregateCapUtilization,
      globalRouteMix,
      globalRejectionReasonsByCategory: globalRejectionReasons,
      topPrincipalsByCalls,
      topPrincipalsByValueSettled,
      period,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Principal-scoped queries (scoped by user_id)
  // ═══════════════════════════════════════════════════════════

  /** Count metered calls from the aggregation view for a user in the period. */
  private async countMeteredCalls(userId: string, period: AnalyticsPeriod): Promise<number> {
    const { data } = await supabase
      .from('v3_analytics_calls_metered')
      .select('calls_count', { head: false })
      .eq('user_id', userId)
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    return data ? data.reduce((sum, row) => sum + Number(row.calls_count), 0) : 0;
  }

  /** Sum settled value from the aggregation view for a user. */
  private async sumSettledValue(userId: string, period: AnalyticsPeriod): Promise<number> {
    const { data } = await supabase
      .from('v3_analytics_settlements')
      .select('value_settled', { head: false })
      .eq('user_id', userId)
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    return data ? data.reduce((sum, row) => sum + Number(row.value_settled), 0) : 0;
  }

  /** Sum unsettled value from the aggregation view for a user. */
  private async sumUnsettledValue(userId: string, period: AnalyticsPeriod): Promise<number> {
    const { data } = await supabase
      .from('v3_analytics_settlements')
      .select('value_unsettled', { head: false })
      .eq('user_id', userId)
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    return data ? data.reduce((sum, row) => sum + Number(row.value_unsettled), 0) : 0;
  }

  /** Count active channels for a user from the aggregation view. */
  private async countActiveChannels(userId: string): Promise<number> {
    const { data } = await supabase
      .from('v3_analytics_active_channels')
      .select('active_channel_count', { head: false })
      .eq('user_id', userId);

    if (!data || data.length === 0) return 0;
    return Number(data[0].active_channel_count) ?? 0;
  }

  /** Cap utilization per channel for a user. */
  private async getCapUtilization(userId: string): Promise<CapUtilization[]> {
    const { data: channels } = await supabase
      .from('payment_channels')
      .select('channel_id, balance, deposit_amount')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (!channels || channels.length === 0) return [];

    return channels.map(channel => {
      const deposit = Number(channel.deposit_amount) || 0;
      const balance = Number(channel.balance) || 0;
      // deposit_amount represents the channel capacity
      const capacity = deposit > 0 ? deposit : balance;
      return {
        agentId: channel.channel_id,
        agentName: `Channel ${channel.channel_id.slice(0, 8)}`,
        currentBalance: balance,
        capacity,
        utilizationPercentage: capacity > 0 ? (balance / capacity) * 100 : 0,
      };
    });
  }

  /**
   * Route mix for a user — distribution of channel payments by subscription.
   * Since channel_payments has subscription_id, we group by that.
   */
  private async getRouteMix(userId: string, period: AnalyticsPeriod): Promise<RouteMixEntry[]> {
    const { data } = await supabase
      .from('channel_payments')
      .select('subscription_id, amount')
      .eq('user_id', userId)
      .gte('created_at', period.start)
      .lte('created_at', period.end);

    if (!data || data.length === 0) return [];

    const totalCalls = data.length;
    const routeMap = new Map<string, { count: number; valueSettled: number }>();

    data.forEach(row => {
      const route = row.subscription_id;
      const existing = routeMap.get(route) ?? { count: 0, valueSettled: 0 };
      existing.count++;
      existing.valueSettled += Number(row.amount) || 0;
      routeMap.set(route, existing);
    });

    return Array.from(routeMap.entries()).map(([route, { count, valueSettled }]) => ({
      route,
      callsCount: count,
      percentage: totalCalls > 0 ? (count / totalCalls) * 100 : 0,
      valueSettled,
    }));
  }

  /**
   * Rejection reasons for a user from the aggregation view.
   */
  private async getRejectionReasons(userId: string, period: AnalyticsPeriod): Promise<RejectionCategory[]> {
    const { data } = await supabase
      .from('v3_analytics_rejections')
      .select('category, rejection_count')
      .eq('user_id', userId)
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    if (!data || data.length === 0) return [];

    const totalRejections = data.reduce((sum, row) => sum + Number(row.rejection_count), 0);

    return data.map(row => {
      const count = Number(row.rejection_count);
      return {
        category: row.category,
        count,
        percentage: totalRejections > 0 ? (count / totalRejections) * 100 : 0,
        topReasons: [{ reason: row.category, count }],
      };
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Operator-scoped queries (global, no user_id filter)
  // ═══════════════════════════════════════════════════════════

  private async countAllMeteredCalls(period: AnalyticsPeriod): Promise<number> {
    const { data } = await supabase
      .from('v3_analytics_calls_metered')
      .select('calls_count', { head: false })
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    return data ? data.reduce((sum, row) => sum + Number(row.calls_count), 0) : 0;
  }

  private async sumAllSettledValue(period: AnalyticsPeriod): Promise<number> {
    const { data } = await supabase
      .from('v3_analytics_settlements')
      .select('value_settled', { head: false })
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    return data ? data.reduce((sum, row) => sum + Number(row.value_settled), 0) : 0;
  }

  private async sumAllUnsettledValue(period: AnalyticsPeriod): Promise<number> {
    const { data } = await supabase
      .from('v3_analytics_settlements')
      .select('value_unsettled', { head: false })
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    return data ? data.reduce((sum, row) => sum + Number(row.value_unsettled), 0) : 0;
  }

  private async countAllActiveChannels(): Promise<number> {
    const { data } = await supabase
      .from('v3_analytics_active_channels')
      .select('active_channel_count', { head: false });

    if (!data || data.length === 0) return 0;
    return data.reduce((sum, row) => sum + Number(row.active_channel_count), 0);
  }

  private async getAllCapUtilization(): Promise<CapUtilization[]> {
    const { data: channels } = await supabase
      .from('payment_channels')
      .select('channel_id, balance, deposit_amount, user_id')
      .eq('status', 'active');

    if (!channels || channels.length === 0) return [];

    // Group by user_id (agent/principal) and aggregate
    const agentMap = new Map<string, { balance: number; capacity: number }>();
    channels.forEach(channel => {
      const deposit = Number(channel.deposit_amount) || 0;
      const balance = Number(channel.balance) || 0;
      const capacity = deposit > 0 ? deposit : balance;
      const existing = agentMap.get(channel.user_id) ?? { balance: 0, capacity: 0 };
      existing.balance += balance;
      existing.capacity += capacity;
      agentMap.set(channel.user_id, existing);
    });

    return Array.from(agentMap.entries()).map(([agentId, { balance, capacity }]) => ({
      agentId,
      agentName: `Principal ${agentId.slice(0, 8)}`,
      currentBalance: balance,
      capacity,
      utilizationPercentage: capacity > 0 ? (balance / capacity) * 100 : 0,
    }));
  }

  private async getAllRouteMix(period: AnalyticsPeriod): Promise<RouteMixEntry[]> {
    const { data } = await supabase
      .from('channel_payments')
      .select('subscription_id, amount')
      .gte('created_at', period.start)
      .lte('created_at', period.end);

    if (!data || data.length === 0) return [];

    const totalCalls = data.length;
    const routeMap = new Map<string, { count: number; valueSettled: number }>();

    data.forEach(row => {
      const route = row.subscription_id;
      const existing = routeMap.get(route) ?? { count: 0, valueSettled: 0 };
      existing.count++;
      existing.valueSettled += Number(row.amount) || 0;
      routeMap.set(route, existing);
    });

    return Array.from(routeMap.entries()).map(([route, { count, valueSettled }]) => ({
      route,
      callsCount: count,
      percentage: totalCalls > 0 ? (count / totalCalls) * 100 : 0,
      valueSettled,
    }));
  }

  private async getAllRejectionReasons(period: AnalyticsPeriod): Promise<RejectionCategory[]> {
    const { data } = await supabase
      .from('v3_analytics_rejections')
      .select('category, rejection_count')
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    if (!data || data.length === 0) return [];

    const totalRejections = data.reduce((sum, row) => sum + Number(row.rejection_count), 0);

    return data.map(row => {
      const count = Number(row.rejection_count);
      return {
        category: row.category,
        count,
        percentage: totalRejections > 0 ? (count / totalRejections) * 100 : 0,
        topReasons: [{ reason: row.category, count }],
      };
    });
  }

  private async getTopPrincipalsByCalls(period: AnalyticsPeriod): Promise<PrincipalMetric[]> {
    const { data } = await supabase
      .from('v3_analytics_calls_metered')
      .select('user_id, calls_count')
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    if (!data || data.length === 0) return [];

    const userCounts = new Map<string, number>();
    data.forEach(row => {
      userCounts.set(row.user_id, (userCounts.get(row.user_id) ?? 0) + Number(row.calls_count));
    });

    return Array.from(userCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([principalId, value]) => ({ principalId, principalName: principalId, value }));
  }

  private async getTopPrincipalsByValueSettled(period: AnalyticsPeriod): Promise<PrincipalMetric[]> {
    const { data } = await supabase
      .from('v3_analytics_settlements')
      .select('user_id, value_settled')
      .gte('period_day', period.start.slice(0, 10))
      .lte('period_day', period.end.slice(0, 10));

    if (!data || data.length === 0) return [];

    const userValues = new Map<string, number>();
    data.forEach(row => {
      userValues.set(row.user_id, (userValues.get(row.user_id) ?? 0) + Number(row.value_settled));
    });

    return Array.from(userValues.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([principalId, value]) => ({ principalId, principalName: principalId, value }));
  }

  /** Default period: last 30 days */
  private defaultPeriod(): AnalyticsPeriod {
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return { start, end, granularity: DEFAULT_GRANULARITY };
  }
}

// ── Singleton export ──────────────────────────────────────────

export const analyticsV3Service = new AnalyticsV3Service();