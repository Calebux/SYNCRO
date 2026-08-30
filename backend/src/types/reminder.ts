export interface ReminderSchedule {
  id: string;
  subscription_id: string;
  user_id: string;
  reminder_date: string;
  reminder_type: 'renewal' | 'trial_expiry' | 'cancellation';
  days_before: number;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  jitter_offset_hours?: number; // ±N hours, stored for audit
  created_at: string;
  updated_at: string;
}

export interface NotificationDelivery {
  id: string;
  reminder_schedule_id: string;
  user_id: string;
  channel: 'email' | 'push' | 'telegram' | 'slack';
  status: 'pending' | 'sent' | 'failed' | 'retrying';
  attempt_count: number;
  max_attempts: number;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  error_message: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  email_account_id: string | null;
  merchant_id: string | null;
  name: string;
  provider: string;
  category: string | null;
  price: number;
  billing_cycle: string;
  status: string;
  /** ISO-8601 UTC timestamp of the next billing event. */
  next_billing_date: string | null;
  logo_url: string | null;
  website_url: string | null;
  renewal_url: string | null;
  notes: string | null;
  tags: string[];
  /** ISO-8601 UTC timestamp when the subscription expired. */
  expired_at: string | null;
  /** ISO-8601 UTC timestamp until which the subscription is active. */
  active_until: string | null;
  // Trial tracking fields
  is_trial: boolean;
  /** ISO-8601 UTC timestamp when the trial ends. */
  trial_ends_at: string | null;
  trial_converts_to_price: number | null;
  credit_card_required: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  timezone: string;
  currency: string;
}

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

export interface NotificationPayload {
  title: string;
  body: string;
  subscription: Subscription;
  reminderType: ReminderSchedule['reminder_type'];
  daysBefore: number;
  renewalDate: string;
  priority?: NotificationPriority;
}

export interface DeliveryResult {
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Timestamp and timezone storage rules for UserPreferences
 * ─────────────────────────────────────────────────────────
 * • `updated_at`           — ISO-8601 UTC string (TIMESTAMPTZ in DB).
 * • `quiet_hours_start`    — Wall-clock time in HH:MM (24-hour) format.
 *                            Stored as a bare TIME in the DB; has no timezone
 *                            component of its own.  Always interpreted in the
 *                            context of `quiet_hours_timezone`.
 * • `quiet_hours_end`      — Same format and rules as `quiet_hours_start`.
 * • `quiet_hours_timezone` — IANA timezone identifier (e.g. "America/New_York").
 *                            All quiet-hours comparisons MUST be performed in
 *                            this timezone, never in raw UTC.
 *
 * Rendering rule: when displaying any timestamp to the user, convert from UTC
 * to `quiet_hours_timezone` (or the profile-level `timezone` field) using the
 * `date-fns-tz` library on the backend or `Intl.DateTimeFormat` on the client.
 */
export interface UserPreferences {
  user_id: string;
  notification_channels: ('email' | 'push' | 'telegram' | 'slack')[];
  reminder_timing: number[]; // days before
  reminder_jitter_level: 'off' | 'low' | 'medium' | 'high'; // low=±2h, medium=±6h, high=±12h
  email_opt_ins: {
    marketing: boolean;
    reminders: boolean;
    updates: boolean;
  };
  automation_flags: {
    auto_renew: boolean;
    auto_retry: boolean;
  };
  risk_notification_threshold?: 'LOW' | 'MEDIUM' | 'HIGH';
  quiet_hours_enabled: boolean;
  /** Wall-clock start of quiet hours in HH:MM (24-hour) format. */
  quiet_hours_start: string;
  /** Wall-clock end of quiet hours in HH:MM (24-hour) format. */
  quiet_hours_end: string;
  /** IANA timezone identifier used to interpret quiet_hours_start/end. */
  quiet_hours_timezone: string;
  critical_alerts_only: boolean;
  currency: string;
  timezone: string;
  locale: string;
  calendar_sync_enabled: boolean;
  calendar_export_reminders: boolean;
  /** id of the preferred gift-card purchasing provider (see client/lib/gift-card-providers/). */
  preferred_gift_card_provider: string;
  privacy_mode_enabled: boolean;
  encryption_key?: string;
  /** Subscription IDs in personal priority order (highest first). */
  subscription_priority_order: string[];
  /** ISO-8601 UTC string. */
  updated_at: string;
}

export interface ReminderSettings {
  user_id: string;
  reminder_days_before: number[];
  created_at: string;
  updated_at: string;
}

export type PartialUserPreferences = Partial<Omit<UserPreferences, 'user_id' | 'updated_at'>>;
