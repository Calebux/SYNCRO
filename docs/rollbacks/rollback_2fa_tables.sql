-- ============================================================
-- ROLLBACK: 2FA Tables
-- Covers migration:
--   supabase/migrations/20240117000000_add_2fa_tables.sql
-- Risk: HIGH — drops recovery_codes; users lose 2FA recovery access.
--             Must disable 2FA enforcement on all teams first.
-- ============================================================

-- ── VERIFICATION (run before rollback) ──────────────────────
-- CRITICAL: Ensure no teams have 2FA enforcement active.
-- Rolling back while require_2fa = true locks users out.
--
--   SELECT id, name FROM public.teams WHERE require_2fa = true;
--   -- Must return 0 rows before proceeding.
--
-- Check how many users have 2FA enabled:
--
--   SELECT COUNT(*) FROM public.profiles WHERE two_fa_enabled_at IS NOT NULL;
--   -- Inform users before rollback if count > 0.
--
-- Check unused recovery codes:
--
--   SELECT COUNT(*) FROM public.recovery_codes WHERE used_at IS NULL;

-- ── ROLLBACK ────────────────────────────────────────────────

BEGIN;

-- 1. Disable 2FA enforcement on all teams (safety guard)
UPDATE public.teams
  SET require_2fa = false, require_2fa_set_at = NULL
  WHERE require_2fa = true;

-- 2. Drop recovery_codes table (WARNING: all codes permanently lost)
DROP TABLE IF EXISTS public.recovery_codes CASCADE;

-- 3. Remove 2FA columns from teams
ALTER TABLE public.teams
  DROP COLUMN IF EXISTS require_2fa,
  DROP COLUMN IF EXISTS require_2fa_set_at;

-- 4. Remove 2FA column from profiles
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS two_fa_enabled_at;

-- ── POST-ROLLBACK VERIFICATION ───────────────────────────────
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'recovery_codes';
--   -- Expected: 0 rows
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'teams'
--     AND column_name IN ('require_2fa', 'require_2fa_set_at');
--   -- Expected: 0 rows

COMMIT;
