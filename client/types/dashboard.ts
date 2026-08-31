/**
 * Typed contracts for the Dashboard page data slices.
 *
 * These types sit between the raw DB `Subscription` (snake_case, from
 * @/lib/supabase/subscriptions) and the dashboard UI. They capture only the
 * fields the dashboard actually reads, making the prop surface explicit and
 * compiler-checked.
 */

// ── Subscription card ─────────────────────────────────────────────────────────

/** Status values the dashboard renders UI branches for. */
export type SubscriptionStatus =
  | "active"
  | "cancelled"
  | "paused"
  | "trial"
  | "expiring"
  | "expired"

/** A subscription as consumed by the dashboard card grid. */
export interface DashboardSubscription {
  id: number
  name: string
  category: string
  price: number
  icon: string
  /** Days until next renewal (null = unknown). */
  renews_in: number | null
  status: SubscriptionStatus | string
  color: string
  renewal_url: string | null
  tags: string[]
  date_added: string
  email_account_id: number | null
  /** Source email address (populated by email-scan integrations). */
  email?: string
  last_used_at?: string
  has_api_key?: boolean
  is_trial: boolean
  trial_ends_at?: string
  price_after_trial?: number
  trial_converts_to_price?: number
  credit_card_required?: boolean
  source: string
  manually_edited: boolean
  edited_fields: string[]
  pricing_type: string
  billing_cycle: string
  cancelled_at?: string
  active_until?: string
  paused_at?: string
  resumes_at?: string
  price_range?: { min: number; max: number }
  price_history?: Array<{ date: string; amount: number }>
  /** ISO currency code for this subscription's price (e.g. "USD", "EUR"). */
  currency?: string
  is_encrypted?: boolean
  /** True when a price increase has been detected since last renewal. */
  priceChange?: boolean
}

// ── Insight / notification ────────────────────────────────────────────────────

export type InsightType =
  | "duplicate"
  | "unused"
  | "price_change"
  | "renewal"
  | "budget"
  | "consolidation"
  | "alert"
  | "info"

/** A single insight/notification item passed to the dashboard. */
export interface DashboardInsight {
  id: string | number
  title: string
  description: string
  type: InsightType | string
  read: boolean
  /** Present on duplicate-type insights. */
  duplicateInfo?: {
    name: string
    count: number
    totalCost: number
    potentialSavings: number
  }
  /** Present on subscription-linked insights. */
  subscriptionId?: number
  /** Present on detected-subscription insights. */
  detectedSubscription?: Partial<DashboardSubscription>
  /** Present on price-change insights. */
  priceChangeInfo?: {
    id: number
    name: string
    oldPrice: number
    newPrice: number
    annualImpact: number
  }
  /** Present on consolidation insights. */
  suggestionId?: string | number
}

// ── Email account ─────────────────────────────────────────────────────────────

export interface DashboardEmailAccount {
  id: number
  email: string
  provider?: string
  last_synced?: string
  isPrimary?: boolean
}

// ── Derived metric shapes (returned by subscription-utils) ────────────────────

/** A group of subscriptions with the same name (potential duplicate). */
export interface DuplicateGroup {
  name: string
  count: number
  subscriptions: DashboardSubscription[]
  totalCost: number
  potentialSavings: number
}

/** A subscription flagged as potentially unused. */
export interface UnusedSubscription extends DashboardSubscription {
  potentiallyWasted: true
  /** null when last_interaction_at has never been set. */
  daysSinceInteraction: number | null
}
