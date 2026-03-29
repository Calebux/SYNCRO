export interface Subscription {
  id: string;
  user_id: string;
  email_account_id: string | null;
  merchant_id: string | null;
  name: string;
  provider: string;
  price: number;
  currency: string;
  billing_cycle: "monthly" | "yearly" | "quarterly";
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
  // In Subscription interface — add after expired_at
  paused_at: string | null;
  resume_at: string | null;
  pause_reason: string | null;
}

export interface SubscriptionCreateInput {
  name: string;
  provider?: string;
  merchant_id?: string;
  price: number;
  currency?: string;
  billing_cycle: "monthly" | "yearly" | "quarterly";
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
}

export interface SubscriptionUpdateInput {
  name?: string;
  provider?: string;
  merchant_id?: string;
  price?: number;
  currency?: string;
  billing_cycle?: "monthly" | "yearly" | "quarterly";
  status?: "active" | "cancelled" | "paused" | "trial" | "expired";
  next_billing_date?: string;
  category?: string;
  logo_url?: string;
  website_url?: string;
  renewal_url?: string;
  notes?: string;
  tags?: string[];
  // In Subscription interface — add after expired_at
  paused_at?: string | null;
  resume_at?: string | null;
  pause_reason?: string | null;
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
  limit?: number;
  offset?: number;
}

export interface ListSubscriptionsResult {
  subscriptions: Subscription[];
  total: number;
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