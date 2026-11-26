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
  is_checkpoint BOOLEAN NOT NULL DEFAULT false,
  checkpointed_amount NUMERIC(20,8),
  checkpoint_nonce VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(channel_id, state_number),
  CONSTRAINT channel_states_checkpoint_fields CHECK (
    (is_checkpoint = false AND checkpointed_amount IS NULL AND checkpoint_nonce IS NULL)
    OR (is_checkpoint = true AND checkpointed_amount IS NOT NULL AND checkpoint_nonce IS NOT NULL)
  ),
  CONSTRAINT channel_states_checkpointed_amount_non_negative CHECK (
    checkpointed_amount IS NULL OR checkpointed_amount >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_channel_states_channel_id ON channel_states(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_states_state_number ON channel_states(state_number);
CREATE INDEX IF NOT EXISTS idx_channel_states_confirmed ON channel_states(confirmed);
CREATE INDEX IF NOT EXISTS idx_channel_states_is_checkpoint ON channel_states(channel_id, is_checkpoint);
CREATE INDEX IF NOT EXISTS idx_channel_states_checkpoint_nonce ON channel_states(channel_id, checkpoint_nonce);

-- Only one checkpoint per nonce per channel, preventing double payout of the same checkpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_states_unique_checkpoint_nonce
  ON channel_states(channel_id, checkpoint_nonce)
  WHERE is_checkpoint = true;

-- Enforce monotonic checkpointed amount per channel: each checkpoint must exceed the previous one
CREATE OR REPLACE FUNCTION enforce_channel_states_checkpoint_monotonic()
RETURNS TRIGGER AS $$
DECLARE
  last_amount NUMERIC(20,8);
BEGIN
  IF NEW.is_checkpoint = true THEN
    SELECT MAX(checkpointed_amount) INTO last_amount
    FROM channel_states
    WHERE channel_id = NEW.channel_id
      AND is_checkpoint = true
      AND id <> COALESCE(NEW.id, -1);

    IF last_amount IS NOT NULL AND NEW.checkpointed_amount <= last_amount THEN
      RAISE EXCEPTION 'checkpointed_amount % must exceed last checkpoint % for channel %',
        NEW.checkpointed_amount, last_amount, NEW.channel_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_channel_states_checkpoint_monotonic ON channel_states;
CREATE TRIGGER trg_channel_states_checkpoint_monotonic
  BEFORE INSERT OR UPDATE ON channel_states
  FOR EACH ROW
  EXECUTE FUNCTION enforce_channel_states_checkpoint_monotonic();

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
COMMENT ON COLUMN channel_states.is_checkpoint IS 'Whether this state row records a partial withdrawal checkpoint';
COMMENT ON COLUMN channel_states.checkpointed_amount IS 'Cumulative amount paid out to the payee at this checkpoint';
COMMENT ON COLUMN channel_states.checkpoint_nonce IS 'Nonce of the checkpointed state, unique per channel to prevent double payout';
