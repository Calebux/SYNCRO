-- ──────────────────────────────────────────────────────────────────────────────
-- Key Rotation Support for Wallet Changes
--
-- Tracks encryption key rotation and re-encryption progress when users
-- change their Stellar wallet, ensuring data remains accessible.
-- ──────────────────────────────────────────────────────────────────────────────

-- Store the old wallet public key temporarily during rotation
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS previous_wallet_public_key TEXT,
  ADD COLUMN IF NOT EXISTS previous_encryption_key TEXT,
  ADD COLUMN IF NOT EXISTS rotation_in_progress BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS rotation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rotation_completed_at TIMESTAMPTZ;

-- Table to track re-encryption progress for each subscription
CREATE TABLE IF NOT EXISTS public.subscription_reencryption_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  old_wallet_public_key TEXT NOT NULL,
  new_wallet_public_key TEXT NOT NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, subscription_id, new_wallet_public_key)
);

-- Index for tracking progress by user
CREATE INDEX IF NOT EXISTS idx_reencryption_progress_user_status 
  ON public.subscription_reencryption_progress(user_id, status);

-- Index for tracking progress by subscription
CREATE INDEX IF NOT EXISTS idx_reencryption_progress_subscription 
  ON public.subscription_reencryption_progress(subscription_id);

COMMENT ON TABLE public.subscription_reencryption_progress IS
  'Tracks re-encryption progress when user changes wallet and encryption keys are rotated.';

COMMENT ON COLUMN public.subscription_reencryption_progress.status IS
  'Status: pending, in_progress, completed, or failed';

COMMENT ON COLUMN public.subscription_reencryption_progress.old_wallet_public_key IS
  'Previous wallet public key used for old encryption';

COMMENT ON COLUMN public.subscription_reencryption_progress.new_wallet_public_key IS
  'New wallet public key for new encryption';

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_reencryption_progress_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamps
DROP TRIGGER IF EXISTS trigger_update_reencryption_progress_timestamp 
  ON public.subscription_reencryption_progress;

CREATE TRIGGER trigger_update_reencryption_progress_timestamp
  BEFORE UPDATE ON public.subscription_reencryption_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_reencryption_progress_timestamp();
