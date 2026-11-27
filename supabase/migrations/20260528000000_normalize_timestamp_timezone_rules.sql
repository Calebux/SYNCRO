-- Migration: Normalize timestamp and timezone storage rules (Issue #71)
--
-- Canonical rules enforced by this migration:
--
--   1. All TIMESTAMP columns that represent a point in time MUST be
--      TIMESTAMPTZ (timestamp with time zone), stored in UTC.
--
--   2. Bare TIME columns (quiet_hours_start, quiet_hours_end) represent a
--      wall-clock time with NO timezone component.  They are always
--      interpreted in the context of the companion quiet_hours_timezone
--      column (IANA identifier, e.g. "America/New_York").
--
--   3. Blockchain lifecycle timestamps (blockchain_created_at, etc.) are
--      stored as BIGINT Unix epoch seconds, as dictated by the Soroban
--      contract.  Application code converts them to TIMESTAMPTZ for display.
--
--   4. The `reminder_date` column in reminder_schedules is a bare DATE.
--      It represents a calendar day in UTC.  The scheduler fires at 09:00 UTC
--      on that date; per-user timezone rendering is handled at the
--      presentation layer.
--
-- This migration adds or corrects column comments to make the rules
-- self-documenting in the database schema.

-- ── user_preferences ────────────────────────────────────────────────────────

COMMENT ON COLUMN public.user_preferences.created_at IS
  'UTC timestamp (TIMESTAMPTZ) when the row was created.';

COMMENT ON COLUMN public.user_preferences.updated_at IS
  'UTC timestamp (TIMESTAMPTZ) of the last update, maintained by trigger.';

COMMENT ON COLUMN public.user_preferences.quiet_hours_start IS
  'Wall-clock start of quiet hours in HH:MM (24-hour) format. '
  'No timezone component; always interpreted in quiet_hours_timezone.';

COMMENT ON COLUMN public.user_preferences.quiet_hours_end IS
  'Wall-clock end of quiet hours in HH:MM (24-hour) format. '
  'No timezone component; always interpreted in quiet_hours_timezone.';

COMMENT ON COLUMN public.user_preferences.quiet_hours_timezone IS
  'IANA timezone identifier (e.g. America/New_York) used to evaluate '
  'quiet_hours_start and quiet_hours_end. Must never be empty when '
  'quiet_hours_enabled is TRUE; defaults to UTC.';

-- ── subscriptions ────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.subscriptions.next_billing_date IS
  'UTC timestamp (TIMESTAMPTZ) of the next scheduled billing event.';

COMMENT ON COLUMN public.subscriptions.expired_at IS
  'UTC timestamp (TIMESTAMPTZ) when the subscription expired, or NULL if active.';

COMMENT ON COLUMN public.subscriptions.paused_at IS
  'UTC timestamp (TIMESTAMPTZ) when the subscription was paused, or NULL.';

COMMENT ON COLUMN public.subscriptions.resume_at IS
  'UTC timestamp (TIMESTAMPTZ) when a paused subscription is scheduled to resume.';

COMMENT ON COLUMN public.subscriptions.last_interaction_at IS
  'UTC timestamp (TIMESTAMPTZ) of the most recent user interaction.';

COMMENT ON COLUMN public.subscriptions.last_renewal_attempt_at IS
  'UTC timestamp (TIMESTAMPTZ) of the most recent renewal attempt (success or failure). '
  'Used to enforce the renewal cooldown window.';

COMMENT ON COLUMN public.subscriptions.blockchain_created_at IS
  'Unix epoch seconds (BIGINT) from the Soroban contract ledger timestamp. '
  'Convert to TIMESTAMPTZ for display: to_timestamp(blockchain_created_at).';

COMMENT ON COLUMN public.subscriptions.blockchain_activated_at IS
  'Unix epoch seconds (BIGINT) from the Soroban contract ledger timestamp. '
  'Convert to TIMESTAMPTZ for display: to_timestamp(blockchain_activated_at).';

COMMENT ON COLUMN public.subscriptions.blockchain_last_renewed_at IS
  'Unix epoch seconds (BIGINT) from the Soroban contract ledger timestamp. '
  'Convert to TIMESTAMPTZ for display: to_timestamp(blockchain_last_renewed_at).';

COMMENT ON COLUMN public.subscriptions.blockchain_canceled_at IS
  'Unix epoch seconds (BIGINT) from the Soroban contract ledger timestamp. '
  'Convert to TIMESTAMPTZ for display: to_timestamp(blockchain_canceled_at).';

-- ── reminder_schedules ───────────────────────────────────────────────────────

COMMENT ON COLUMN public.reminder_schedules.reminder_date IS
  'Calendar date (DATE, no time component) on which the reminder fires. '
  'The scheduler processes reminders at 09:00 UTC on this date. '
  'Timezone rendering for display is handled at the presentation layer.';

COMMENT ON COLUMN public.reminder_schedules.created_at IS
  'UTC timestamp (TIMESTAMPTZ) when the reminder was scheduled.';

COMMENT ON COLUMN public.reminder_schedules.updated_at IS
  'UTC timestamp (TIMESTAMPTZ) of the last status change.';

-- ── notification_deliveries ──────────────────────────────────────────────────

COMMENT ON COLUMN public.notification_deliveries.last_attempt_at IS
  'UTC timestamp (TIMESTAMPTZ) of the most recent delivery attempt.';

COMMENT ON COLUMN public.notification_deliveries.next_retry_at IS
  'UTC timestamp (TIMESTAMPTZ) after which the next retry may be attempted.';

-- ── delayed_notifications ────────────────────────────────────────────────────

COMMENT ON COLUMN public.delayed_notifications.original_send_time IS
  'UTC timestamp (TIMESTAMPTZ) when the notification was originally due to be sent.';

COMMENT ON COLUMN public.delayed_notifications.scheduled_send_time IS
  'UTC timestamp (TIMESTAMPTZ) of the rescheduled delivery time '
  '(i.e. when quiet hours end in the user''s timezone).';
