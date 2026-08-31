/**
 * Subscription Types - Strongly typed domain models for subscription management
 */

/**
 * Subscription status enumeration
 */
export type SubscriptionStatus =
  | "active"
  | "paused"
  | "trial"
  | "expiring"
  | "expired"
  | "cancelled";

/**
 * Visibility level for subscriptions
 */
export type VisibilityLevel = "private" | "team";

/**
 * Price change record for tracking subscription price modifications
 */
export interface PriceChange {
  old_price: number;
  new_price: number;
}

/**
 * Core Subscription model
 * Represents a user's subscription to a service
 */
export interface Subscription {
  id: number;
  name: string;
  category: string;
  email?: string;
  price: number;
  status: SubscriptionStatus;
  renewsIn: number;
  icon: string;
  visibility: VisibilityLevel;

  // Trial-related fields
  isTrial: boolean;
  trialEndsAt?: string;
  priceAfterTrial?: number;
  billingCycle?: string;

  // Price change tracking
  latest_price_change?: PriceChange;
}

/**
 * Represents a group of duplicate subscriptions
 */
export interface DuplicateGroup {
  subscriptions: Subscription[];
  count: number;
}

/**
 * Represents an unused subscription
 */
export interface UnusedSubscription {
  id: number;
  name: string;
  category: string;
  price: number;
  status: SubscriptionStatus;
  renewsIn: number;
}

/**
 * Email account associated with subscription
 */
export interface EmailAccount {
  email: string;
}

/**
 * Filter state for advanced filtering
 */
export interface AdvancedFilters {
  categories: string[];
  statuses: SubscriptionStatus[];
  priceRange: [number, number] | null;
}
