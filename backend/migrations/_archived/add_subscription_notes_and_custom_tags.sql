-- Migration: Add subscription notes and custom tags
-- Issue #178

-- 1. Add notes column to subscriptions
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Create user-owned custom tags table
CREATE TABLE IF NOT EXISTS subscription_tags (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name  TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  UNIQUE (user_id, name)
);

-- Index for fast per-user lookups
CREATE INDEX IF NOT EXISTS idx_subscription_tags_user_id
  ON subscription_tags (user_id);

-- Enable RLS
ALTER TABLE subscription_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own tags"
  ON subscription_tags
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Many-to-many junction: subscriptions ↔ custom tags
CREATE TABLE IF NOT EXISTS subscription_tag_assignments (
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tag_id          UUID NOT NULL REFERENCES subscription_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (subscription_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_assignments_subscription
  ON subscription_tag_assignments (subscription_id);

CREATE INDEX IF NOT EXISTS idx_tag_assignments_tag
  ON subscription_tag_assignments (tag_id);

-- Enable RLS (join through subscriptions user ownership)
ALTER TABLE subscription_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own tag assignments"
  ON subscription_tag_assignments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_id
        AND s.user_id = auth.uid()
    )
  );
