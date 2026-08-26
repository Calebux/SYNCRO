/**
 * Hand-written payment domain types (not generated from schema or ABI).
 */

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';
export type PaymentMethod = 'card' | 'bank_transfer' | 'crypto' | 'gift_card' | 'other';

export interface Payment {
  id: string;
  userId: string;
  subscriptionId?: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method: PaymentMethod;
  transactionId?: string | null;
  transactionHash?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  processedAt?: string | null;
}

export interface CreatePaymentInput {
  subscriptionId?: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  transactionId?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentHistoryEntry {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  date: string;
  subscriptionName?: string;
}

export interface ChannelRecommendation {
  recommendedDeposit: number;
  monthlyCost: number;
  safetyMarginPercent: number;
  volatilityBufferPercent: number;
  renewalsBeforeTopUp: number;
  settlementFrequency: 'weekly' | 'biweekly' | 'monthly';
  breakdown: {
    name: string;
    monthlyEquivalent: number;
    billingCycle: string;
    originalAmount: number;
  }[];
  currency: string;
}
