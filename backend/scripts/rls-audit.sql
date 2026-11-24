-- RLS Audit Query
-- Run this against your Supabase database to verify all public tables have RLS enabled.
-- CI uses scripts/check-rls.sh which wraps this query and fails if any table is missing RLS.

-- 1. Tables with RLS disabled (should return 0 rows in a compliant state)
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;

-- 2. Full RLS status for all public tables
SELECT
  t.schemaname,
  t.tablename,
  t.rowsecurity                          AS rls_enabled,
  COUNT(p.policyname)                    AS policy_count,
  ARRAY_AGG(p.policyname ORDER BY p.policyname) FILTER (WHERE p.policyname IS NOT NULL) AS policies
FROM pg_tables t
LEFT JOIN pg_policies p
  ON p.schemaname = t.schemaname
  AND p.tablename = t.tablename
WHERE t.schemaname = 'public'
GROUP BY t.schemaname, t.tablename, t.rowsecurity
ORDER BY t.tablename;

-- 3. Tables with RLS enabled but zero policies
-- These are intentional system tables (see RLS_EXCEPTIONS below).
-- Any table appearing here that is NOT in the exceptions list is a gap.
SELECT
  t.schemaname,
  t.tablename,
  'RLS enabled, no user policies (system table or gap)' AS note
FROM pg_tables t
LEFT JOIN pg_policies p
  ON p.schemaname = t.schemaname
  AND p.tablename = t.tablename
WHERE t.schemaname = 'public'
  AND t.rowsecurity = true
GROUP BY t.schemaname, t.tablename
HAVING COUNT(p.policyname) = 0
ORDER BY t.tablename;

-- RLS_EXCEPTIONS (tables with RLS enabled but intentionally no user-facing policies):
--   contract_events  - system table; written by service role event listener; users access data via blockchain_logs
--   event_cursor     - singleton system table; managed exclusively by backend service role
