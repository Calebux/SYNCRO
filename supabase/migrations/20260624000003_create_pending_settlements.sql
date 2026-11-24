-- Create pending_settlements table for batched settlement queue
CREATE TABLE IF NOT EXISTS pending_settlements (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id VARCHAR(255) NOT NULL REFERENCES payment_channels(channel_id) ON DELETE CASCADE,
  settlement_amount NUMERIC(20,8) NOT NULL,
  transaction_hash VARCHAR(255),
  settlement_fee NUMERIC(20,8),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'batched', 'settled', 'failed', 'cancelled')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  settled_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_pending_settlements_user_id ON pending_settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_settlements_channel_id ON pending_settlements(channel_id);
CREATE INDEX IF NOT EXISTS idx_pending_settlements_status ON pending_settlements(status);
CREATE INDEX IF NOT EXISTS idx_pending_settlements_created_at ON pending_settlements(created_at);

-- Enable RLS
ALTER TABLE pending_settlements ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "pending_settlements_select_own"
  ON pending_settlements FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "pending_settlements_insert_own"
  ON pending_settlements FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "pending_settlements_update_own"
  ON pending_settlements FOR UPDATE
  USING (user_id = auth.uid());

COMMENT ON TABLE pending_settlements IS 'Queue of pending channel settlements waiting to be batched on-chain';
COMMENT ON COLUMN pending_settlements.settlement_amount IS 'Amount to settle on-chain';
COMMENT ON COLUMN pending_settlements.settlement_fee IS 'Estimated or actual network fee for settlement';
COMMENT ON COLUMN pending_settlements.status IS 'Current settlement status in the pipeline';
COMMENT ON COLUMN pending_settlements.retry_count IS 'Number of times settlement has been attempted';
