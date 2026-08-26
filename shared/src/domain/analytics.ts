/**
 * Hand-written analytics domain types (not generated from schema or ABI).
 */

import type { SubscriptionStatus, BillingCycle } from './subscription';

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
