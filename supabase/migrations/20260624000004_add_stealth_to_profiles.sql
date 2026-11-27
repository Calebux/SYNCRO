-- Add stealth meta address to profiles for privacy
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stealth_meta_address TEXT,
  ADD COLUMN IF NOT EXISTS stealth_meta_address_created_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_profiles_stealth_meta_address ON profiles(stealth_meta_address) 
  WHERE stealth_meta_address IS NOT NULL;

COMMENT ON COLUMN profiles.stealth_meta_address IS 'Master stealth address (meta-address) for deterministic derivation of per-subscription stealth addresses';
COMMENT ON COLUMN profiles.stealth_meta_address_created_at IS 'When the stealth meta address was generated';
