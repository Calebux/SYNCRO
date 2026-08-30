/**
 * Shared analytics domain models
 */

import { SubscriptionStatus, BillingCycle } from './subscription';

/**
 * Analytics summary for user's subscriptions
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

/**
 * Spending trend data point
 */
export interface SpendingTrend {
  period: string; // ISO date or month identifier
  amount: number;
  currency: string;
  subscriptionCount: number;
}

/**
 * Renewal event
 */
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

/**
 * Category spending breakdown
 */
export interface CategorySpending {
  category: string;
  totalAmount: number;
  subscriptionCount: number;
  percentage: number;
}
