export interface Subscription {
  id: string;
  user_id: string;
  email_account_id: string | null;
  merchant_id: string | null;
  name: string;
  provider: string;
  price: number;
  currency: string;
  billing_cycle: "monthly" | "yearly" | "quarterly" | "weekly" | "annual";
  status: "active" | "cancelled" | "paused" | "trial" | "expired";
  next_billing_date: string | null;
  category: string | null;
  logo_url: string | null;
  website_url: string | null;
  renewal_url: string | null;
  notes: string | null;
  visibility: 'private' | 'team';
  tags: string[];
  expired_at: string | null;
  created_at: string;
  updated_at: string;
  last_renewal_cycle_id?: number | null;
  blockchain_created_at?: number | null;
  blockchain_activated_at?: number | null;
  blockchain_last_renewed_at?: number | null;
  blockchain_canceled_at?: number | null;
  paused_at: string | null;
  resume_at: string | null;
  pause_reason: string | null;
  last_interaction_at: string | null;
  last_renewal_attempt_at?: string | null;
  failure_count?: number;
  stealth_index: number;
  stealth_address: string | null;
  is_encrypted: boolean;
}

export interface SubscriptionCreateInput {
  name: string;
  provider?: string;
  merchant_id?: string;
  price: number;
  currency?: string;
  billing_cycle: "monthly" | "yearly" | "quarterly" | "weekly" | "annual";
  status?: "active" | "cancelled" | "paused" | "trial" | "expired";
  next_billing_date?: string;
  category?: string;
  logo_url?: string;
  website_url?: string;
  renewal_url?: string;
  notes?: string;
  visibility?: 'private' | 'team';
  tags?: string[];
  email_account_id?: string;
  // Trial fields
  is_trial?: boolean;
  trial_ends_at?: string;
  trial_converts_to_price?: number;
  credit_card_required?: boolean;
}

export interface SubscriptionUpdateInput {
  name?: string;
  provider?: string;
  merchant_id?: string;
  price?: number;
  currency?: string;
  billing_cycle?: "monthly" | "yearly" | "quarterly" | "weekly" | "annual";
  status?: "active" | "cancelled" | "paused" | "trial" | "expired";
  next_billing_date?: string;
  category?: string;
  logo_url?: string;
  website_url?: string;
  renewal_url?: string;
  notes?: string;
  tags?: string[];
  paused_at?: string | null;
  resume_at?: string | null;
  pause_reason?: string | null;
  // Trial fields
  is_trial?: boolean;
  trial_ends_at?: string | null;
  trial_converts_to_price?: number | null;
  credit_card_required?: boolean;
}

/** Allowlist of fields a user is permitted to update.
 *  Does NOT include id, user_id, created_at — those can never be user-modified. */
export interface SubscriptionUpdateAllowlist {
  name?: string;
  provider?: string;
  merchant_id?: string;
  price?: number;
  currency?: string;
  billing_cycle?: Subscription["billing_cycle"];
  status?: Subscription["status"];
  next_billing_date?: string;
  category?: string;
  logo_url?: string;
  website_url?: string;
  renewal_url?: string;
  notes?: string;
  visibility?: 'private' | 'team';
  tags?: string[];
}

export interface ListSubscriptionsOptions {
  status?: Subscription["status"];
  category?: string;
  encryptedOnly?: boolean;
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface ListSubscriptionsResult {
  subscriptions: Subscription[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

// ── Notification Preference Types ────────────────────────────────────────────

export type NotificationChannel = 'email' | 'push' | 'telegram' | 'slack';

export interface SubscriptionNotificationPreferences {
  subscription_id: string;
  reminder_days_before: number[];
  channels: NotificationChannel[];
  muted: boolean;
  muted_until: string | null;
  custom_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreferencesUpdateInput {
  reminder_days_before?: number[];
  channels?: NotificationChannel[];
  muted?: boolean;
  muted_until?: string | null;
  custom_message?: string | null;
}

export interface SnoozeInput {
  until: string; // ISO date string e.g. '2025-04-01'
}