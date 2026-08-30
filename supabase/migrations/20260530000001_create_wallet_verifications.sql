-- ──────────────────────────────────────────────────────────────────────────────
-- Wallet Verifications
--
-- Persists verified wallet associations separately from user_metadata so that
-- verification records survive metadata resets and are queryable for audit and
-- reconciliation purposes.
--
-- Re-verification rules (duplicated in code for reference):
--   - A new verification for the same (user_id, public_key) updates the existing
--     record (verified_at, signature) rather than creating a duplicate.
--   - A new verification for the same user_id but a *different* public_key is
--     appended as a new row; the previous key remains valid unless explicitly
--     revoked via wallet_verification_revocations.
--   - A verification older than 365 days SHOULD be re-challenged on next wallet
--     status check (soft expiry; does not auto-revoke).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  public_key    TEXT NOT NULL,
  message       TEXT NOT NULL,
  signature     TEXT NOT NULL,
  verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID,              -- user_id who revoked (NULL = auto-revocation)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_wallet_verifications_user_id
  ON wallet_verifications (user_id);

-- Index for public key lookups (reconciliation)
CREATE INDEX IF NOT EXISTS idx_wallet_verifications_public_key
  ON wallet_verifications (public_key);

-- Unique constraint on (user_id, public_key) — one active verification per key per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_verifications_user_key
  ON wallet_verifications (user_id, public_key) WHERE revoked_at IS NULL;

COMMENT ON TABLE wallet_verifications IS
  'Persisted wallet verification records for Stellar wallet associations.';

COMMENT ON COLUMN wallet_verifications.public_key IS
  'Stellar Ed25519 public key (validated by StrKey.isValidEd25519PublicKey).';

COMMENT ON COLUMN wallet_verifications.message IS
  'The challenge message that was signed.';

COMMENT ON COLUMN wallet_verifications.signature IS
  'Base64-encoded Ed25519 signature of the challenge message.';

COMMENT ON COLUMN wallet_verifications.verified_at IS
  'When this verification was completed.';

COMMENT ON COLUMN wallet_verifications.revoked_at IS
  'When this verification was revoked (NULL = still valid).';

-- ──────────────────────────────────────────────────────────────────────────────
-- Wallet Verification Revocations (audit trail for re-verification)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_verification_revocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  public_key      TEXT NOT NULL,
  reason          TEXT NOT NULL,
  revoked_by      UUID,              -- user_id who initiated the revocation
  revoked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_verification_revocations_user
  ON wallet_verification_revocations (user_id);

COMMENT ON TABLE wallet_verification_revocations IS
  'Audit trail for wallet verification revocations.';
