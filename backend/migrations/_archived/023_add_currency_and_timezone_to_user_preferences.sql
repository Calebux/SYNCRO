-- Add currency, timezone and locale to user_preferences
-- Standardize display rules across the UI (issue #616)

ALTER TABLE public.user_preferences 
ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-US';

-- Add comment explaining the fields
COMMENT ON COLUMN public.user_preferences.currency IS 'User preferred display currency (ISO 4217 or crypto)';
COMMENT ON COLUMN public.user_preferences.timezone IS 'User primary timezone (IANA identifier)';
COMMENT ON COLUMN public.user_preferences.locale IS 'User preferred locale for formatting';
