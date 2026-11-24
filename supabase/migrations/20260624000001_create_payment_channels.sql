-- Create payment_channels table for off-chain transactions
CREATE TABLE IF NOT EXISTS payment_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel_id VARCHAR(255) NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  recipient_id VARCHAR(255),
  counterparty TEXT NOT NULL DEFAULT 'SYNCRO Executor',
  deposit_amount NUMERIC(18, 6) NOT NULL DEFAULT 0,
  balance NUMERIC(18, 6) NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'closing', 'closed', 'dispute')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closing', 'closed', 'disputed')),
  channel_state JSONB,
  state_signature TEXT,
  on_chain_channel_id TEXT,
  expiry TIMESTAMPTZ,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_channels_user_id ON payment_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_channels_channel_id ON payment_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_payment_channels_status ON payment_channels(status);
CREATE INDEX IF NOT EXISTS idx_payment_channels_opened_at ON payment_channels(opened_at);

-- Enable RLS
ALTER TABLE payment_channels ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "payment_channels_select_own"
  ON payment_channels FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "payment_channels_insert_own"
  ON payment_channels FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "payment_channels_update_own"
  ON payment_channels FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "payment_channels_delete_own"
  ON payment_channels FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON TABLE payment_channels IS 'Off-chain payment channel metadata for privacy-preserving transactions';
COMMENT ON COLUMN payment_channels.channel_id IS 'Unique channel identifier on the blockchain';
COMMENT ON COLUMN payment_channels.balance IS 'Current off-chain balance in the channel';
COMMENT ON COLUMN payment_channels.status IS 'Current state of the channel (active, closing, closed, disputed)';
