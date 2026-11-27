-- Create renewal_logs table for tracking renewal execution
CREATE TABLE IF NOT EXISTS renewal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  transaction_hash TEXT,
  failure_reason TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create renewal_approvals table for tracking approvals
CREATE TABLE IF NOT EXISTS renewal_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  approval_id TEXT NOT NULL,
  max_spend NUMERIC,
  expires_at TIMESTAMPTZ,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subscription_id, approval_id)
);

-- Create indexes
CREATE INDEX idx_renewal_logs_subscription ON renewal_logs(subscription_id);
CREATE INDEX idx_renewal_logs_user ON renewal_logs(user_id);
CREATE INDEX idx_renewal_logs_status ON renewal_logs(status);
CREATE INDEX idx_renewal_approvals_subscription ON renewal_approvals(subscription_id);
CREATE INDEX idx_renewal_approvals_used ON renewal_approvals(used);
