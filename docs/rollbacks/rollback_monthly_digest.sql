-- ============================================================
-- ROLLBACK: Monthly Digest
-- Covers migration:
--   supabase/migrations/20240116000000_add_monthly_digest.sql
-- Risk: MEDIUM — drops digest_audit_log history and user preferences.
-- ============================================================

-- ── VERIFICATION (run before rollback) ──────────────────────
-- Check how many users have digest enabled (they will stop receiving it):
--
--   SELECT COUNT(*) FROM public.user_preferences WHERE digest_enabled = true;
--
-- Check digest audit history that will be lost:
--
--   SELECT COUNT(*) FROM public.digest_audit_log;
--   SELECT status, COUNT(*) FROM public.digest_audit_log GROUP BY status;

-- ── ROLLBACK ────────────────────────────────────────────────

BEGIN;

-- 1. Drop digest audit log table
DROP TABLE IF EXISTS public.digest_audit_log CASCADE;

-- 2. Remove digest columns from user_preferences
ALTER TABLE public.user_preferences
  DROP COLUMN IF EXISTS digest_enabled,
  DROP COLUMN IF EXISTS digest_day,
  DROP COLUMN IF EXISTS include_year_to_date;

-- ── POST-ROLLBACK VERIFICATION ───────────────────────────────
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'digest_audit_log';
--   -- Expected: 0 rows
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'user_preferences'
--     AND column_name IN ('digest_enabled', 'digest_day', 'include_year_to_date');
--   -- Expected: 0 rows

COMMIT;
