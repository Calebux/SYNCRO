-- ============================================================
-- ROLLBACK: Renewal Tables
-- Covers migrations:
--   supabase/migrations/20240102000000_create_renewal_tables.sql
--   supabase/migrations/20240112000000_create_renewal_locks.sql
-- Risk: HIGH — drops billing/renewal audit history
-- ============================================================

-- ── VERIFICATION (run before rollback) ──────────────────────
-- Confirm row counts so you know what will be lost:
--
--   SELECT COUNT(*) FROM renewal_logs;
--   SELECT COUNT(*) FROM renewal_approvals;
--   SELECT COUNT(*) FROM renewal_locks;
--
-- Expected safe-to-rollback state:
--   renewal_locks: no rows with status = 'active'
--   renewal_approvals: no rows with used = false that are unexpired
--
-- SELECT COUNT(*) FROM renewal_locks WHERE status = 'active';
-- SELECT COUNT(*) FROM renewal_approvals WHERE used = false AND expires_at > NOW();

-- ── ROLLBACK ────────────────────────────────────────────────

BEGIN;

-- 1. Drop renewal_locks (depends on subscriptions FK)
DROP TABLE IF EXISTS renewal_locks CASCADE;

-- 2. Drop renewal_approvals (depends on subscriptions FK)
DROP TABLE IF EXISTS renewal_approvals CASCADE;

-- 3. Drop renewal_logs (depends on subscriptions FK)
DROP TABLE IF EXISTS renewal_logs CASCADE;

-- ── POST-ROLLBACK VERIFICATION ───────────────────────────────
-- Run after COMMIT to confirm tables are gone:
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('renewal_logs', 'renewal_approvals', 'renewal_locks');
--   -- Expected: 0 rows

COMMIT;
