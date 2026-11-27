-- Create payment_channels table for off-chain transactions
CREATE TABLE IF NOT EXISTS payment_channels (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id VARCHAR(255) NOT NULL UNIQUE,
  recipient_id VARCHAR(255) NOT NULL,
  balance NUMERIC(20,8) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closing', 'closed', 'disputed')),
  opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
