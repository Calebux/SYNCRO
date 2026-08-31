-- ============================================================
-- ROLLBACK: Budget & Slack
-- Covers migration:
--   supabase/migrations/20260501000000_budget_and_slack.sql
-- Risk: MEDIUM — drops budget alert history; users lose budget
--               tracking and Slack webhook config.
-- ============================================================

-- ── VERIFICATION (run before rollback) ──────────────────────
-- Check how many teams have Slack configured:
--
--   SELECT COUNT(*) FROM public.teams WHERE slack_webhook_url IS NOT NULL;
--
-- Check active budget configurations:
--
--   SELECT COUNT(*) FROM public.profiles
--   WHERE monthly_budget IS NOT NULL;
--
-- Check alert history that will be lost:
--
--   SELECT COUNT(*) FROM public.budget_alert_logs;

-- ── ROLLBACK ────────────────────────────────────────────────

BEGIN;

-- 1. Drop budget_alert_logs table
DROP TABLE IF EXISTS public.budget_alert_logs CASCADE;

-- 2. Remove budget columns from profiles
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS monthly_budget,
  DROP COLUMN IF EXISTS budget_alert_threshold;

-- 3. Remove Slack webhook from teams
ALTER TABLE public.teams
  DROP COLUMN IF EXISTS slack_webhook_url;

-- ── POST-ROLLBACK VERIFICATION ───────────────────────────────
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'budget_alert_logs';
--   -- Expected: 0 rows
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'profiles'
--     AND column_name IN ('monthly_budget', 'budget_alert_threshold');
--   -- Expected: 0 rows

COMMIT;
