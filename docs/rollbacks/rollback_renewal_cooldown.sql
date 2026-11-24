-- ============================================================
-- ROLLBACK: Renewal Cooldown
-- Covers migration:
--   supabase/migrations/20240114000000_add_renewal_cooldown.sql
-- Risk: MEDIUM-HIGH — removes cooldown guard; rapid retry storms
--                     become possible until re-applied.
-- ============================================================

-- ── VERIFICATION (run before rollback) ──────────────────────
-- Confirm no active cooldowns that would be silently bypassed:
--
--   SELECT COUNT(*) FROM public.subscriptions
--   WHERE last_renewal_attempt_at > NOW() - INTERVAL '10 minutes';
--
-- Confirm subscription_renewal_attempts columns exist:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'subscription_renewal_attempts'
--     AND column_name IN ('attempt_type', 'updated_subscription_record');

-- ── ROLLBACK ────────────────────────────────────────────────

BEGIN;

-- 1. Revoke function permissions
REVOKE EXECUTE ON FUNCTION check_renewal_cooldown(UUID, INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION update_last_renewal_attempt(UUID) FROM authenticated;

-- 2. Drop helper functions
DROP FUNCTION IF EXISTS check_renewal_cooldown(UUID, INTEGER);
DROP FUNCTION IF EXISTS update_last_renewal_attempt(UUID);

-- 3. Drop index on last_renewal_attempt_at
DROP INDEX IF EXISTS public.idx_subscriptions_last_renewal_attempt;

-- 4. Remove columns added to subscription_renewal_attempts
ALTER TABLE public.subscription_renewal_attempts
  DROP COLUMN IF EXISTS attempt_type,
  DROP COLUMN IF EXISTS updated_subscription_record;

-- 5. Remove cooldown columns from subscriptions
ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS last_renewal_attempt_at,
  DROP COLUMN IF EXISTS renewal_cooldown_minutes;

-- ── POST-ROLLBACK VERIFICATION ───────────────────────────────
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'subscriptions'
--     AND column_name IN ('last_renewal_attempt_at', 'renewal_cooldown_minutes');
--   -- Expected: 0 rows
--
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('check_renewal_cooldown', 'update_last_renewal_attempt');
--   -- Expected: 0 rows

COMMIT;
