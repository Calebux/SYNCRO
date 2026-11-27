-- zk_nullifiers: tracks spent nullifiers to prevent double-spend on ZK payment proofs.
-- Rows expire after the TTL (730 days by default) and are pruned by archiveExpired().

CREATE TABLE IF NOT EXISTS zk_nullifiers (
  nullifier   CHAR(64)     NOT NULL PRIMARY KEY,   -- hex-encoded SHA-256, 64 chars
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id  TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS zk_nullifiers_expires_at_idx ON zk_nullifiers (expires_at);
CREATE INDEX IF NOT EXISTS zk_nullifiers_user_id_idx    ON zk_nullifiers (user_id);

-- RLS: users can only read their own nullifiers; only service role may insert/delete.
ALTER TABLE zk_nullifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own nullifiers"
  ON zk_nullifiers FOR SELECT
  USING (auth.uid() = user_id);
