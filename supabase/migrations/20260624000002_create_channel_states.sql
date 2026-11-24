-- Create channel_states table for off-chain state history
CREATE TABLE IF NOT EXISTS channel_states (
  id BIGSERIAL PRIMARY KEY,
  channel_id VARCHAR(255) NOT NULL REFERENCES payment_channels(channel_id) ON DELETE CASCADE,
  state_number BIGINT NOT NULL,
  balance NUMERIC(20,8) NOT NULL,
  nonce VARCHAR(255) NOT NULL,
  signature TEXT NOT NULL,
  counterparty_signature TEXT,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(channel_id, state_number)
);

CREATE INDEX IF NOT EXISTS idx_channel_states_channel_id ON channel_states(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_states_state_number ON channel_states(state_number);
CREATE INDEX IF NOT EXISTS idx_channel_states_confirmed ON channel_states(confirmed);

-- Enable RLS by joining to payment_channels
ALTER TABLE channel_states ENABLE ROW LEVEL SECURITY;

-- RLS policies - access through payment_channels ownership
CREATE POLICY "channel_states_select_own"
  ON channel_states FOR SELECT
  USING (channel_id IN (
    SELECT channel_id FROM payment_channels WHERE user_id = auth.uid()
  ));

CREATE POLICY "channel_states_insert_own"
  ON channel_states FOR INSERT
  WITH CHECK (channel_id IN (
    SELECT channel_id FROM payment_channels WHERE user_id = auth.uid()
  ));

CREATE POLICY "channel_states_update_own"
  ON channel_states FOR UPDATE
  USING (channel_id IN (
    SELECT channel_id FROM payment_channels WHERE user_id = auth.uid()
  ));

COMMENT ON TABLE channel_states IS 'Off-chain state updates for payment channels';
COMMENT ON COLUMN channel_states.state_number IS 'Monotonically increasing state counter';
COMMENT ON COLUMN channel_states.nonce IS 'Unique nonce for this state update';
COMMENT ON COLUMN channel_states.confirmed IS 'Whether this state has been confirmed by both parties';
