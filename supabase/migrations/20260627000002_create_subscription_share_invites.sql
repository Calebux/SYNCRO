-- Subscription sharing via secure invite links (Issue #968)
CREATE TABLE IF NOT EXISTS subscription_share_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  permission_level TEXT NOT NULL DEFAULT 'view-only'
    CHECK (permission_level IN ('view-only', 'can-renew', 'full-access')),
  max_uses INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_invites_subscription ON subscription_share_invites(subscription_id);
CREATE INDEX IF NOT EXISTS idx_share_invites_created_by ON subscription_share_invites(created_by);
CREATE INDEX IF NOT EXISTS idx_share_invites_expires ON subscription_share_invites(expires_at);

CREATE TABLE IF NOT EXISTS subscription_share_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id UUID NOT NULL REFERENCES subscription_share_invites(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'accepted', 'revoked', 'expired', 'viewed')),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_audit_invite ON subscription_share_audit_log(invite_id);
CREATE INDEX IF NOT EXISTS idx_share_audit_subscription ON subscription_share_audit_log(subscription_id);

ALTER TABLE subscription_share_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_share_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY share_invites_owner_access ON subscription_share_invites
  FOR ALL USING (created_by = auth.uid());

CREATE POLICY share_audit_owner_access ON subscription_share_audit_log
  FOR SELECT USING (
    invite_id IN (SELECT id FROM subscription_share_invites WHERE created_by = auth.uid())
  );
