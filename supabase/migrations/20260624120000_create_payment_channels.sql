-- Payment channels for off-chain recurring subscription renewals
CREATE TABLE IF NOT EXISTS payment_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  counterparty TEXT NOT NULL DEFAULT 'SYNCRO Executor',
  deposit_amount NUMERIC(18, 6) NOT NULL,
  balance NUMERIC(18, 6) NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'closing', 'closed', 'dispute')),
  channel_state JSONB,
  state_signature TEXT,
  on_chain_channel_id TEXT,
  expiry TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_channels_user_id ON payment_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_channels_state ON payment_channels(state);

ALTER TABLE payment_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_channels_user_policy ON payment_channels
  FOR ALL USING (auth.uid() = user_id);
