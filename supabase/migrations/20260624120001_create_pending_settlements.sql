-- Pending settlements queue for mixnet-style batch on-chain submission
CREATE TABLE IF NOT EXISTS pending_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  amount NUMERIC(18, 6) NOT NULL,
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('renewal', 'channel_close')),
  payload JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'failed')),
  batch_id TEXT,
  transaction_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_settlements_status ON pending_settlements(status);
CREATE INDEX IF NOT EXISTS idx_pending_settlements_created_at ON pending_settlements(created_at);

ALTER TABLE pending_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_settlements_user_policy ON pending_settlements
  FOR ALL USING (auth.uid() = user_id);

-- Stealth address column on renewal logs for local audit trail
ALTER TABLE renewal_logs
  ADD COLUMN IF NOT EXISTS stealth_address TEXT,
  ADD COLUMN IF NOT EXISTS ephemeral_pubkey TEXT;
