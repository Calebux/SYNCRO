-- Migration: dismissed_suggestions table for smart suggestion engine
-- Issue #192

CREATE TABLE IF NOT EXISTS dismissed_suggestions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subscription_id  UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  suggestion_type  TEXT        NOT NULL,
  dismissed_until  TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, subscription_id, suggestion_type)
);

CREATE INDEX IF NOT EXISTS idx_dismissed_suggestions_user ON dismissed_suggestions (user_id);
