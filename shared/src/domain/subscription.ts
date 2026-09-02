/**
 * Hand-written domain types.
 *
 * These describe application concepts that exist in neither the database
 * schema snapshot nor the contract ABI. Generated counterparts live in
 * `shared/src/generated`.
 */

export type SubscriptionStatus = 'active' | 'cancelled' | 'paused' | 'trial' | 'expired';
export type BillingCycle = 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'annual';
export type PricingType = 'fixed' | 'variable' | 'tiered' | 'usage-based';
export type SubscriptionSource = 'manual' | 'email' | 'api' | 'import';

/**
 * Core subscription entity
 * Represents a user's subscription across all layers
 */
export interface Subscription {
  id: string;
  userId: string;
  name: string;
  provider: string;
  price: number;
  currency?: string;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  nextBillingDate: string | null;
  category: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  renewalUrl: string | null;
  notes: string | null;
  tags: string[];

  isTrial?: boolean;
  trialEndsAt?: string | null;
  priceAfterTrial?: number | null;
  creditCardRequired?: boolean;

  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
  activeUntil?: string | null;
  pausedAt?: string | null;
  resumesAt?: string | null;

  source?: SubscriptionSource;
  manuallyEdited?: boolean;
  editedFields?: string[];
  pricingType?: PricingType;
  hasApiKey?: boolean;
  lastUsedAt?: string | null;
  emailAccountId?: string | null;
}

export interface CreateSubscriptionInput {
  name: string;
  price: number;
  billingCycle: BillingCycle;
  provider?: string;
  currency?: string;
  status?: SubscriptionStatus;
  nextBillingDate?: string;
  category?: string;
  logoUrl?: string;
  websiteUrl?: string;
  renewalUrl?: string;
  notes?: string;
  tags?: string[];
  isTrial?: boolean;
  trialEndsAt?: string;
  priceAfterTrial?: number;
  creditCardRequired?: boolean;
}

export interface UpdateSubscriptionInput {
  name?: string;
  price?: number;
  billingCycle?: BillingCycle;
  provider?: string;
  currency?: string;
  status?: SubscriptionStatus;
  nextBillingDate?: string;
  category?: string;
  logoUrl?: string;
  websiteUrl?: string;
  renewalUrl?: string;
  notes?: string;
  tags?: string[];
  isTrial?: boolean;
  trialEndsAt?: string;
  priceAfterTrial?: number;
}

export interface SubscriptionFilters {
  page?: number;
  limit?: number;
  offset?: number;
  status?: SubscriptionStatus;
  category?: string;
  cursor?: string;
}

export interface SubscriptionNotificationPreferences {
  reminderDaysBefore?: number[];
  channels?: ('email' | 'push' | 'telegram' | 'slack')[];
  muted?: boolean;
  mutedUntil?: string | null;
  customMessage?: string | null;
}
