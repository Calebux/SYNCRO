-- Update user_preferences table with additional privacy columns
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS preferred_gift_card_provider TEXT DEFAULT 'paypal';

COMMENT ON COLUMN user_preferences.preferred_gift_card_provider IS 'User preferred provider for gift card redemption';
