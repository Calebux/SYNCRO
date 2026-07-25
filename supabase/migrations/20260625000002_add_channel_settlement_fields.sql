-- Per-user channel settlement schedule and last settlement timestamp
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS channel_settlement_schedule TEXT
    NOT NULL DEFAULT 'monthly'
    CHECK (channel_settlement_schedule IN ('monthly', 'quarterly'));

ALTER TABLE payment_channels
  ADD COLUMN IF NOT EXISTS last_settlement_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.channel_settlement_schedule IS
  'How often accumulated channel balances are settled on-chain';
