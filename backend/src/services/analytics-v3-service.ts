import { supabase } from '../config/database';
import logger from '../config/logger';
import { dependencyHealthService } from './dependency-health-service';
import {
  PrincipalAnalytics,
  OperatorAnalytics,
  AnalyticsPeriod,
  CapUtilization,
  RouteMixEntry,
  RejectionCategory,
  RejectionReason,
  PrincipalMetric,
  ChannelHealth,
  PrincipalAlert,
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
      channelHealth,
      alerts,
    ] = await Promise.all([
      this.countMeteredCalls(userId, period),
      this.sumSettledValue(userId, period),
      this.sumUnsettledValue(userId, period),
      this.countActiveChannels(userId),
      this.getCapUtilization(userId),
      this.getRouteMix(userId, period),
      this.getRejectionReasons(userId, period),
      this.getChannelHealth(userId, period),
      this.getPrincipalAlerts(userId, period),
    ]);

    return {
      callsMetered,
      valueSettled,
      valueUnsettled,
      activeChannels,
      capUtilizationPerAgent: capUtilization.map((agent) => {
        const channel = channelHealth.find((item) => item.channelId === agent.agentId);
        const projectedCapAt = channel?.burnRatePerDay && agent.currentBalance > 0
          ? new Date(Date.now() + (agent.currentBalance / channel.burnRatePerDay) * 86_400_000).toISOString()
          : null;
        return {
          ...agent,
          dailySpendRate: channel?.burnRatePerDay ?? 0,
          projectedCapAt,
        };
      }),
      routeMix,
      rejectionReasonsByCategory: rejectionReasons,
      channelHealth,
      alerts,
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
      .eq('state', 'active');

    if (!channels || channels.length === 0) return [];

    return channels.map(channel => {
      const deposit = Number(channel.deposit_amount) || 0;
      const balance = Number(channel.balance) || 0;
      // deposit_amount represents the channel capacity
      const capacity = deposit > 0 ? deposit : balance;
      const currentSpend = Math.max(0, capacity - balance);
      return {
        agentId: channel.channel_id,
        agentName: `Channel ${channel.channel_id.slice(0, 8)}`,
        currentBalance: balance,
        capacity,
        utilizationPercentage: capacity > 0 ? (balance / capacity) * 100 : 0,
        currentSpend,
      };
    });
  }

  /** Derive channel burn and exhaustion from the last 30 days of metered payments. */
  private async getChannelHealth(userId: string, period: AnalyticsPeriod): Promise<ChannelHealth[]> {
    const [{ data: channels }, { data: payments }] = await Promise.all([
      supabase
        .from('payment_channels')
        .select('channel_id, counterparty, balance, deposit_amount, state, expiry')
        .eq('user_id', userId)
        .neq('state', 'closed'),
      supabase
        .from('channel_payments')
        .select('channel_id, amount, created_at')
        .eq('user_id', userId)
        .gte('created_at', period.start)
        .lte('created_at', period.end),
    ]);

    const paymentTotals = new Map<string, number>();
    for (const payment of payments ?? []) {
      paymentTotals.set(payment.channel_id, (paymentTotals.get(payment.channel_id) ?? 0) + Number(payment.amount || 0));
    }
    const days = Math.max(1, (Date.parse(period.end) - Date.parse(period.start)) / 86_400_000);

    return (channels ?? []).map((channel) => {
      const balance = Number(channel.balance) || 0;
      const capacity = Number(channel.deposit_amount) || balance;
      const burnRatePerDay = (paymentTotals.get(channel.channel_id) ?? 0) / days;
      const exhaustion = burnRatePerDay > 0
        ? new Date(Date.now() + (balance / burnRatePerDay) * 86_400_000).toISOString()
        : null;
      return {
        channelId: channel.channel_id,
        agentName: channel.counterparty || `Channel ${channel.channel_id.slice(0, 8)}`,
        state: channel.state as ChannelHealth['state'],
        balance,
        capacity,
        burnRatePerDay,
        projectedExhaustionAt: exhaustion,
        pendingClose: channel.state === 'closing' || channel.state === 'dispute',
      };
    });
  }

  private async getPrincipalAlerts(userId: string, period: AnalyticsPeriod): Promise<PrincipalAlert[]> {
    const [{ data: channels }, { data: auditEvents }, dependencies] = await Promise.all([
      supabase
        .from('payment_channels')
        .select('channel_id, state, updated_at')
        .eq('user_id', userId)
        .in('state', ['closing', 'dispute']),
      supabase
        .from('audit_logs')
        .select('action, metadata, created_at')
        .gte('created_at', period.start)
        .lte('created_at', period.end)
        .in('action', ['system.degraded_mode', 'reconciliation.adjusted'])
        .order('created_at', { ascending: false })
        .limit(20),
      dependencyHealthService.checkAllDependencies(),
    ]);

    const alerts: PrincipalAlert[] = (auditEvents ?? []).map((event) => ({
      type: event.action === 'system.degraded_mode' ? 'degraded_mode' : 'reconciliation_delta',
      severity: 'critical',
      message: event.action === 'system.degraded_mode'
        ? 'Metering is in degraded mode; some calls may be delayed or unbilled.'
        : 'A reconciliation delta needs attention.',
      createdAt: event.created_at || new Date().toISOString(),
    }));

    if (dependencies.some((dependency) => dependency.status !== 'healthy')) {
      alerts.unshift({
        type: 'degraded_mode',
        severity: 'critical',
        message: 'Metering is in degraded mode; some calls may be delayed or unbilled.',
        createdAt: new Date().toISOString(),
      });
    }

    for (const channel of channels ?? []) {
      alerts.push({
        type: channel.state === 'dispute' ? 'dispute' : 'pending_close',
        severity: channel.state === 'dispute' ? 'critical' : 'warning',
        message: channel.state === 'dispute'
          ? `Channel ${channel.channel_id.slice(0, 8)} is in dispute.`
          : `Channel ${channel.channel_id.slice(0, 8)} has a pending close.`,
        createdAt: channel.updated_at || new Date().toISOString(),
      });
    }

    return alerts;
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
      .from('pending_settlements')
      .select('error_message, status, created_at')
      .eq('user_id', userId)
      .neq('status', 'confirmed')
      .gte('created_at', period.start)
      .lte('created_at', period.end);

    if (!data || data.length === 0) return [];

    const grouped = new Map<string, Map<string, number>>();
    for (const row of data) {
      const reason = this.rejectionReason(row.error_message);
      const category = this.rejectionCategory(reason);
      const reasons = grouped.get(category) ?? new Map<string, number>();
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      grouped.set(category, reasons);
    }

    const totalRejections = data.length;

    return Array.from(grouped.entries()).map(([category, reasons]) => {
      const topReasons = Array.from(reasons.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) => right.count - left.count);
      const count = topReasons.reduce((sum, reason) => sum + reason.count, 0);
      return {
        category,
        count,
        percentage: totalRejections > 0 ? (count / totalRejections) * 100 : 0,
        topReasons,
      };
    });
  }

  private rejectionReason(errorMessage: string | null): string {
    const message = (errorMessage ?? '').toLowerCase();
    if (message.includes('auth') || message.includes('unauthorized')) return 'authentication_failed';
    if (message.includes('rate') || message.includes('limit')) return 'rate_limit_exceeded';
    if (message.includes('valid') || message.includes('malform')) return 'invalid_request';
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('internal')) return 'internal_error';
    if (message.includes('network') || message.includes('connection')) return 'network_unavailable';
    if (message.includes('balance') || message.includes('fund')) return 'insufficient_balance';
    if (message.includes('pay') || message.includes('billing')) return 'billing_failed';
    return 'unspecified_failure';
  }

  private rejectionCategory(reason: string): string {
    if (reason === 'authentication_failed') return 'authentication';
    if (reason === 'rate_limit_exceeded') return 'rate_limit';
    if (reason === 'invalid_request') return 'validation';
    if (reason === 'timeout' || reason === 'internal_error') return 'internal_error';
    if (reason === 'network_unavailable') return 'network';
    if (reason === 'insufficient_balance' || reason === 'billing_failed') return 'billing';
    return 'other';
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