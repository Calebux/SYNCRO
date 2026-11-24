-- Migration: Add stealth meta-address storage to user profiles.
-- Issue: #822 - Persist per-user stealth meta-address for subscription stealth address derivation.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stealth_meta_address TEXT;

COMMENT ON COLUMN public.profiles.stealth_meta_address IS
  'User-level stealth meta-address used to derive unique subscription stealth addresses.';
