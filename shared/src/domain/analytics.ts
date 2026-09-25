/**
 * Hand-written analytics domain types (not generated from schema or ABI).
 */

import type { SubscriptionStatus, BillingCycle } from './subscription';

/**
 * Legacy analytics types (v2) — kept for backward compatibility during migration.
 * @deprecated Use v3 analytics types below.
 */
export interface AnalyticsSummary {
  totalActiveSubscriptions: number;
  totalMonthlyCost: number;
  totalAnnualCost: number;
  subscriptionsByStatus: Record<SubscriptionStatus, number>;
  subscriptionsByCategory: Record<string, number>;
  upcomingRenewals: number;
  averageSubscriptionCost: number;
  mostExpensiveSubscription?: {
    id: string;
    name: string;
    cost: number;
  };
}

export interface SpendingTrend {
  period: string;
  amount: number;
  currency: string;
  subscriptionCount: number;
}

export interface RenewalEvent {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  amount: number;
  billingCycle: BillingCycle;
  renewedAt: string;
  status: 'success' | 'failed';
  transactionHash?: string;
}

export interface CategorySpending {
  category: string;
  totalAmount: number;
  subscriptionCount: number;
  percentage: number;
}

/**
 * V3 Analytics Types — Metrics that matter for usage and settlement.
 *
 * These replace the subscription-centric metrics with channel/usage-centric metrics.
 */

/** Principal-facing analytics (scoped to a single user/principal) */
export interface PrincipalAnalytics {
  /** Total metered calls (webhook deliveries + API calls) in the period */
  callsMetered: number;
  /** Total value settled on-chain in the period */
  valueSettled: number;
  /** Total value pending settlement (unconfirmed batches + channel balances) */
  valueUnsettled: number;
  /** Number of active payment channels */
  activeChannels: number;
  /** Cap utilization per agent (channel balance / capacity) */
  capUtilizationPerAgent: CapUtilization[];
  /** Route mix — distribution of traffic by provider/route */
  routeMix: RouteMixEntry[];
  /** Rejection reasons grouped by category */
  rejectionReasonsByCategory: RejectionCategory[];
  /** Channel-level spend, burn, exhaustion, and close state for the principal console. */
  channelHealth: ChannelHealth[];
  /** Conditions that need attention without requiring log inspection. */
  alerts: PrincipalAlert[];
  /** Period these metrics cover */
  period: AnalyticsPeriod;
}

/** Operator-facing analytics (global, cross-principal) */
export interface OperatorAnalytics {
  /** Total metered calls across all principals */
  totalCallsMetered: number;
  /** Total value settled across all principals */
  totalValueSettled: number;
  /** Total value unsettled across all principals */
  totalValueUnsettled: number;
  /** Total active channels across all principals */
  totalActiveChannels: number;
  /** Aggregated cap utilization across all agents */
  aggregateCapUtilization: CapUtilization[];
  /** Global route mix */
  globalRouteMix: RouteMixEntry[];
  /** Global rejection reasons by category */
  globalRejectionReasonsByCategory: RejectionCategory[];
  /** Top principals by calls metered */
  topPrincipalsByCalls: PrincipalMetric[];
  /** Top principals by value settled */
  topPrincipalsByValueSettled: PrincipalMetric[];
  /** Period these metrics cover */
  period: AnalyticsPeriod;
}

export interface CapUtilization {
  agentId: string;
  agentName: string;
  currentBalance: number;
  capacity: number;
  utilizationPercentage: number;
  currentSpend?: number;
  dailySpendRate?: number;
  projectedCapAt?: string | null;
}

export interface ChannelHealth {
  channelId: string;
  agentName: string;
  state: 'active' | 'closing' | 'closed' | 'dispute';
  balance: number;
  capacity: number;
  burnRatePerDay: number;
  projectedExhaustionAt: string | null;
  pendingClose: boolean;
}

export interface PrincipalAlert {
  type: 'degraded_mode' | 'reconciliation_delta' | 'dispute' | 'pending_close';
  severity: 'warning' | 'critical';
  message: string;
  createdAt: string;
}

export interface RouteMixEntry {
  route: string; // provider or route identifier
  callsCount: number;
  percentage: number;
  valueSettled: number;
}

export interface RejectionCategory {
  category: string; // e.g., 'authentication', 'rate_limit', 'validation', 'internal_error'
  count: number;
  percentage: number;
  topReasons: RejectionReason[];
}

export interface RejectionReason {
  reason: string;
  count: number;
}

export interface PrincipalMetric {
  principalId: string;
  principalName: string;
  value: number;
}

export interface AnalyticsPeriod {
  start: string; // ISO-8601
  end: string; // ISO-8601
  granularity: 'hour' | 'day' | 'week' | 'month';
}

/** Query parameters for analytics endpoints */
export interface AnalyticsQueryParams {
  /** Start of period (ISO-8601), defaults to 30 days ago */
  from?: string;
  /** End of period (ISO-8601), defaults to now */
  to?: string;
  /** Granularity for time-series breakdown */
  granularity?: 'hour' | 'day' | 'week' | 'month';
}