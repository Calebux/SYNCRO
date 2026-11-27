-- Issue #309: ensure idempotent upserts from the Soroban event indexer
-- Add unique constraint on transaction_hash so duplicate events are safely ignored.

ALTER TABLE blockchain_logs
  ADD COLUMN IF NOT EXISTS transaction_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS blockchain_logs_tx_hash_unique
  ON blockchain_logs (transaction_hash)
  WHERE transaction_hash IS NOT NULL;
