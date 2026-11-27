-- Migration: Add stealth address derivation index to subscriptions
-- Issue: #867 - Persist stealth address index for deterministic re-derivation

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stealth_index   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stealth_address TEXT;

COMMENT ON COLUMN subscriptions.stealth_index IS
  'Per-subscription derivation index. Address = HMAC-SHA256(meta_address, subscription_id:stealth_index).';

COMMENT ON COLUMN subscriptions.stealth_address IS
  'Derived stealth address for this subscription (hex-encoded). Re-derivable from stealth_index.';

-- Ensure no two subscriptions for the same user share the same index.
-- (user_id, stealth_index) must be unique to prevent collisions.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_stealth_index_unique
  ON subscriptions (user_id, stealth_index)
  WHERE stealth_address IS NOT NULL;
