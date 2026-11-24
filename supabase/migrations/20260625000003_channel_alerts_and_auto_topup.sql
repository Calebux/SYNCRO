-- Channel alert deduplication and user auto-top-up preferences
CREATE TABLE IF NOT EXISTS channel_alert_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES payment_channels(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, channel_id, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_channel_alert_logs_user_id ON channel_alert_logs(user_id);

ALTER TABLE channel_alert_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_alert_logs_user_policy ON channel_alert_logs
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS channel_auto_top_up BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS channel_auto_top_up_amount NUMERIC(18, 6);

COMMENT ON COLUMN profiles.channel_auto_top_up IS
  'When true, automatically top up channels when balance is low (requires pre-authorization)';
