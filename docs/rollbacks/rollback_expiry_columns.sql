-- ============================================================
-- ROLLBACK: Expiry Columns (add + rework)
-- Covers migrations:
--   supabase/migrations/20240110000000_add_expiry_columns.sql
--   supabase/migrations/20240111000000_rework_expiry.sql
-- Risk: HIGH — rework migration DROPPED expiry_threshold column;
--             rolling back restores it but data is unrecoverable.
-- ============================================================

-- ── VERIFICATION (run before rollback) ──────────────────────
-- Confirm current state of expiry-related columns:
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'subscriptions'
--     AND column_name IN ('expiry_threshold', 'expired_at', 'billing_cycle');
--
-- Confirm no subscriptions are currently in 'expired' status
-- that depend on the expiry logic being rolled back:
--
--   SELECT COUNT(*) FROM public.subscriptions WHERE status = 'expired';

-- ── ROLLBACK ────────────────────────────────────────────────

BEGIN;

-- Reverse 20240111000000_rework_expiry.sql
-- Drop the v2 index added by rework
DROP INDEX IF EXISTS public.idx_subscriptions_expiry_candidates_v2;

-- Drop the GIN index on notifications added by rework
DROP INDEX IF EXISTS public.idx_notifications_subscription_data;

-- Restore the per-subscription expiry_threshold column dropped by rework
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS expiry_threshold INTEGER DEFAULT NULL;

-- Restore the original partial index from 20240110000000_add_expiry_columns.sql
CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry_candidates
  ON public.subscriptions (last_used_at, created_at)
  WHERE status = 'active' AND expiry_threshold IS NOT NULL;

-- Reverse 20240110000000_add_expiry_columns.sql
-- Remove the 'expired' value from the status CHECK constraint
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'cancelled', 'paused', 'trial'));

-- Remove columns added by add_expiry_columns (expiry_threshold already restored above)
-- expired_at was added by add_expiry_columns; only drop if safe
-- WARNING: verify no data in expired_at before dropping
--   SELECT COUNT(*) FROM public.subscriptions WHERE expired_at IS NOT NULL;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS expired_at;

-- ── POST-ROLLBACK VERIFICATION ───────────────────────────────
--
--   -- Confirm expiry_threshold is back, expired_at is gone
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'subscriptions'
--     AND column_name IN ('expiry_threshold', 'expired_at');
--   -- Expected: only expiry_threshold
--
--   -- Confirm constraint no longer allows 'expired'
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.subscriptions'::regclass
--     AND conname = 'subscriptions_status_check';

COMMIT;
