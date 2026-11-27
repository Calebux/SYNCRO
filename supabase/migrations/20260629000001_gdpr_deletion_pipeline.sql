-- GDPR automated deletion pipeline (Issue #948)
-- account_deletions tracks erasure requests; deletion_audit_trail stores metadata-only records.

CREATE TABLE IF NOT EXISTS account_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_deletion_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
  CONSTRAINT valid_scheduled_date CHECK (scheduled_deletion_at > requested_at)
);

CREATE INDEX IF NOT EXISTS idx_account_deletions_status ON account_deletions(status);
CREATE INDEX IF NOT EXISTS idx_account_deletions_scheduled
  ON account_deletions(scheduled_deletion_at) WHERE status = 'pending';

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own deletion status"
  ON account_deletions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can request own deletion"
  ON account_deletions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can cancel own deletion"
  ON account_deletions FOR UPDATE
  USING (auth.uid() = user_id);

-- Audit trail: metadata only, no PII
CREATE TABLE IF NOT EXISTS deletion_audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deletion_id UUID NOT NULL REFERENCES account_deletions(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_audit_trail_deletion_id
  ON deletion_audit_trail(deletion_id);

-- Preserve anonymized audit logs after user deletion
ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
