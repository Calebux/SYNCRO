-- Preferred gift-card purchasing provider (Atomic Wallet, Bitrefill, Coincards, ...)
-- See client/lib/gift-card-providers/ for the provider registry this references.
ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS preferred_gift_card_provider TEXT NOT NULL DEFAULT 'atomic_wallet';

COMMENT ON COLUMN public.user_preferences.preferred_gift_card_provider IS
  'id of the user''s preferred gift-card purchasing provider, e.g. atomic_wallet, bitrefill, coincards';
