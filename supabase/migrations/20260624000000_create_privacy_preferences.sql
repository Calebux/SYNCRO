-- Create privacy_preferences table
CREATE TABLE IF NOT EXISTS privacy_preferences (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stealth_addresses_enabled BOOLEAN NOT NULL DEFAULT false,
  encryption_enabled BOOLEAN NOT NULL DEFAULT false,
  payment_channels_enabled BOOLEAN NOT NULL DEFAULT false,
  private_audit_logs_enabled BOOLEAN NOT NULL DEFAULT false,
  preferred_gift_card_provider TEXT NOT NULL DEFAULT 'paypal',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_privacy_preferences_user_id ON privacy_preferences(user_id);

-- Enable RLS
ALTER TABLE privacy_preferences ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "privacy_preferences_select_own"
  ON privacy_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "privacy_preferences_insert_own"
  ON privacy_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "privacy_preferences_update_own"
  ON privacy_preferences FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "privacy_preferences_delete_own"
  ON privacy_preferences FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON TABLE privacy_preferences IS 'Per-user privacy feature settings and preferences';
COMMENT ON COLUMN privacy_preferences.stealth_addresses_enabled IS 'Enable stealth address derivation for subscriptions';
COMMENT ON COLUMN privacy_preferences.encryption_enabled IS 'Enable on-chain metadata encryption';
COMMENT ON COLUMN privacy_preferences.payment_channels_enabled IS 'Enable payment channels for off-chain transactions';
COMMENT ON COLUMN privacy_preferences.private_audit_logs_enabled IS 'Enable private audit logs with commitment blinding';
COMMENT ON COLUMN privacy_preferences.preferred_gift_card_provider IS 'Default provider for gift card redemption';
