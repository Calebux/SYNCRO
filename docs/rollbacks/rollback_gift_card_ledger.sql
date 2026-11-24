-- ============================================================
-- ROLLBACK: Gift Card Ledger
-- Covers migration:
--   supabase/migrations/20260401000000_create_gift_card_ledger.sql
-- Risk: HIGH — drops financial ledger; all balance history is lost.
--             Ensure no active deductions are in-flight.
-- ============================================================

-- ── VERIFICATION (run before rollback) ──────────────────────
-- Check total ledger entries and balance exposure:
--
--   SELECT COUNT(*), SUM(amount) FROM public.gift_card_ledger;
--
-- Check for recent deductions (last 24h) that may be in-flight:
--
--   SELECT COUNT(*) FROM public.gift_card_ledger
--   WHERE type = 'deduction' AND created_at > NOW() - INTERVAL '24 hours';
--
-- Check the balance view:
--
--   SELECT COUNT(*), SUM(balance) FROM public.gift_card_balance;

-- ── ROLLBACK ────────────────────────────────────────────────

BEGIN;

-- 1. Drop the balance view first (depends on ledger table)
DROP VIEW IF EXISTS public.gift_card_balance;

-- 2. Drop the ledger table
DROP TABLE IF EXISTS public.gift_card_ledger CASCADE;

-- ── POST-ROLLBACK VERIFICATION ───────────────────────────────
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('gift_card_ledger', 'gift_card_balance');
--   -- Expected: 0 rows

COMMIT;
