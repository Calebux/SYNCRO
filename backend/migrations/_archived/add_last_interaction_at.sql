-- Migration: add last_interaction_at to subscriptions for usage tracking
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN subscriptions.last_interaction_at IS
  'Timestamp of the last time the user clicked "Open Site" for this subscription. Used to detect potentially wasted subscriptions (no interaction in 3+ months).';
