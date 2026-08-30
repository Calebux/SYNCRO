-- Migration: referral program tables and profile columns
-- Issue #185

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES profiles(id);

CREATE TABLE IF NOT EXISTS referrals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  referred_user_id UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  referral_code    TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'signed_up', 'converted')),
  signed_up_at     TIMESTAMPTZ,
  converted_at     TIMESTAMPTZ,
  reward_granted   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals (referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code     ON referrals (referral_code);
