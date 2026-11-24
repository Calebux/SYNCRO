-- Renewal dead-letter queue for stuck/failed renewal executions (Issue #962)
CREATE TABLE IF NOT EXISTS renewal_dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  approval_id TEXT,
  amount NUMERIC(12, 2),
  failure_count INTEGER NOT NULL DEFAULT 1,
  last_error_message TEXT,
  last_failure_reason TEXT,
  dead_letter_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_renewal_dlq_subscription ON renewal_dead_letter_queue(subscription_id);
CREATE INDEX IF NOT EXISTS idx_renewal_dlq_user ON renewal_dead_letter_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_renewal_dlq_created ON renewal_dead_letter_queue(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_renewal_dlq_idempotency ON renewal_dead_letter_queue(idempotency_key);

-- Tracks each renewal attempt with its idempotency key
CREATE TABLE IF NOT EXISTS renewal_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'skipped')),
  lock_holder TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_renewal_attempts_subscription_cycle
  ON renewal_attempts(subscription_id, cycle_id);

ALTER TABLE renewal_dead_letter_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY renewal_dlq_user_access ON renewal_dead_letter_queue
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY renewal_attempts_user_access ON renewal_attempts
  FOR SELECT USING (user_id = auth.uid());
