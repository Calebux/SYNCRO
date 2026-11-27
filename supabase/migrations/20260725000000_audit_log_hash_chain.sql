-- Migration: Signed & tamper-evident audit log (Issue #1081)
--
-- Makes `public.audit_logs` append-only and hash-chained, so an administrator
-- cannot silently edit or remove an audit entry.
--
--   1. Every row carries `sequence` (its monotonic position in the chain),
--      `entry_hash` (SHA-256 over the row's contents) and `prev_hash` (the
--      preceding row's `entry_hash`).
--
--   2. Editing a row in place changes what it hashes to; rewriting the stored
--      `entry_hash` to match then breaks the `prev_hash` link held by every
--      later row. Deleting a row leaves a gap in `sequence`. Either way the
--      verification walk (`GET /api/audit/verify`) detects it.
--
--   3. A trigger rejects UPDATE and DELETE outright. Triggers fire for every
--      role including `service_role`, so this holds even for the backend's own
--      credentials — unlike RLS, which the service role bypasses.
--
-- Hashes are computed by the application (`backend/src/services/audit-chain.ts`)
-- so the canonical form is defined in exactly one place.

-- ── Chain columns ───────────────────────────────────────────────────────────

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS sequence   BIGINT,
  ADD COLUMN IF NOT EXISTS entry_hash TEXT,
  ADD COLUMN IF NOT EXISTS prev_hash  TEXT;

COMMENT ON COLUMN public.audit_logs.sequence IS
  'Monotonic position in the hash chain, assigned by the application. '
  'A gap means an entry was deleted.';

COMMENT ON COLUMN public.audit_logs.entry_hash IS
  'SHA-256 over the canonical form of this row (see audit-chain.ts). '
  'Recomputed during verification to detect in-place edits.';

COMMENT ON COLUMN public.audit_logs.prev_hash IS
  'The entry_hash of the preceding entry, or NULL for the genesis entry. '
  'Links the chain so a deleted or reordered entry is detectable.';

-- Two writers racing for the same position must not silently fork the chain:
-- the loser's insert fails and the application retries against the new tip.
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_sequence
  ON public.audit_logs (sequence)
  WHERE sequence IS NOT NULL;

-- Verification walks the chain in sequence order.
CREATE INDEX IF NOT EXISTS idx_audit_logs_sequence_asc
  ON public.audit_logs (sequence ASC);

-- ── Append-only enforcement ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_logs_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % is not permitted (issue #1081)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

COMMENT ON FUNCTION public.audit_logs_append_only() IS
  'Rejects UPDATE/DELETE on audit_logs. Retention pruning requires an operator '
  'to explicitly ALTER TABLE public.audit_logs DISABLE TRIGGER, which is itself '
  'a logged DDL action.';

DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_append_only();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_append_only();

-- The previous policy let any admin JWT delete audit rows, which is exactly the
-- silent-edit path this issue closes. The trigger above supersedes it.
DROP POLICY IF EXISTS audit_logs_delete_admin ON public.audit_logs;

-- ── Backfill note ───────────────────────────────────────────────────────────
--
-- Rows written before this migration have NULL chain columns. They are reported
-- as `unchained` by the verifier rather than as tampering: they cannot be
-- retro-signed without inventing evidence that never existed. The chain begins
-- at the first entry written after this migration is applied.
