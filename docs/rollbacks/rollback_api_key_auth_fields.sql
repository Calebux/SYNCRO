-- ============================================================
-- ROLLBACK: API Key Auth Fields
-- Covers migration:
--   backend/migrations/20260329120000_add_api_key_auth_fields.sql
-- Risk: HIGH — removes key_hash; all API key authentication
--             breaks immediately after rollback.
-- ============================================================

-- ── VERIFICATION (run before rollback) ──────────────────────
-- CRITICAL: Rolling back this migration disables all API key auth.
-- Confirm no active integrations depend on API key access:
--
--   SELECT COUNT(*) FROM public.api_keys WHERE revoked = false;
--
-- Check recent API key usage:
--
--   SELECT COUNT(*) FROM public.api_keys
--   WHERE last_used_at > NOW() - INTERVAL '1 hour';
--   -- If > 0, active integrations will break immediately.

-- ── ROLLBACK ────────────────────────────────────────────────

BEGIN;

-- 1. Drop the unique constraint on key_hash
ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_key_hash_unique;

-- 2. Remove auth and usage tracking columns
ALTER TABLE public.api_keys
  DROP COLUMN IF EXISTS key_hash,
  DROP COLUMN IF EXISTS scopes,
  DROP COLUMN IF EXISTS revoked,
  DROP COLUMN IF EXISTS last_used_at,
  DROP COLUMN IF EXISTS request_count;

-- ── POST-ROLLBACK VERIFICATION ───────────────────────────────
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'api_keys'
--     AND column_name IN ('key_hash', 'scopes', 'revoked', 'last_used_at', 'request_count');
--   -- Expected: 0 rows

COMMIT;
