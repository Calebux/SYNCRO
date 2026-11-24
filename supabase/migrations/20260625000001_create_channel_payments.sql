-- Off-chain channel payment log (privacy-preserving; no on-chain tx per renewal)
CREATE TABLE IF NOT EXISTS channel_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES payment_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL,
  amount NUMERIC(18, 6) NOT NULL,
  sequence_number BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_payments_channel_id ON channel_payments(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_payments_user_id ON channel_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_payments_subscription_id ON channel_payments(subscription_id);

ALTER TABLE channel_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY channel_payments_user_policy ON channel_payments
  FOR ALL USING (auth.uid() = user_id);

COMMENT ON TABLE channel_payments IS 'Local log of off-chain channel renewal payments';
