-- Saga state for renewal execution (Issue #1277)
-- Adds per-attempt saga tracking to renewal_attempts and a step-level
-- idempotency/audit log so a crashed run can resume or compensate
-- correctly instead of restarting from scratch.

ALTER TABLE renewal_attempts
  ADD COLUMN IF NOT EXISTS attempt_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS saga_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (saga_status IN ('pending', 'running', 'compensating', 'completed', 'compensated', 'dead_lettered')),
  ADD COLUMN IF NOT EXISTS current_step TEXT
    CHECK (current_step IN ('reserve', 'authorize_on_chain', 'charge', 'record', 'notify', 'release')),
  ADD COLUMN IF NOT EXISTS completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS step_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS step_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS needs_manual_reconciliation BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_renewal_attempts_attempt_id ON renewal_attempts(attempt_id);

-- Drives the ops dashboard "stuck saga" view.
CREATE INDEX IF NOT EXISTS idx_renewal_attempts_stuck
  ON renewal_attempts(saga_status, step_started_at)
  WHERE saga_status IN ('running', 'compensating');

-- Per-step idempotency + audit log. A (attempt_id, step, direction) row
-- existing means that exact step direction already completed for that
-- attempt, so the executor can safely skip re-running it on resume.
CREATE TABLE IF NOT EXISTS renewal_saga_step_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL,
  step TEXT NOT NULL CHECK (step IN ('reserve', 'authorize_on_chain', 'charge', 'record', 'notify', 'release')),
  direction TEXT NOT NULL CHECK (direction IN ('execute', 'compensate')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  output JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, step, direction)
);

CREATE INDEX IF NOT EXISTS idx_renewal_saga_step_log_attempt ON renewal_saga_step_log(attempt_id);

ALTER TABLE renewal_saga_step_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY renewal_saga_step_log_service_only ON renewal_saga_step_log
  FOR ALL USING (false);