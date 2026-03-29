-- 018_add_currency_to_subscriptions.sql
-- Adds per-subscription currency support for multi-currency feature (#152)

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

COMMENT ON COLUMN subscriptions.currency IS '3-letter ISO 4217 currency code for this subscription price';
