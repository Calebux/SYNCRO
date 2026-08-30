-- Contract events table
CREATE TABLE IF NOT EXISTS contract_events (
  id BIGSERIAL PRIMARY KEY,
  sub_id BIGINT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  ledger INTEGER NOT NULL,
  tx_hash VARCHAR(128) NOT NULL,
  event_data JSONB NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tx_hash, event_type, sub_id)
);

CREATE INDEX idx_contract_events_sub_id ON contract_events(sub_id);
CREATE INDEX idx_contract_events_ledger ON contract_events(ledger);
CREATE INDEX idx_contract_events_type ON contract_events(event_type);

-- RLS for contract_events
-- NOTE: contract_events is a system/backend table written by the event listener service
-- using the service role key. Direct user access is intentionally blocked.
-- The service role bypasses RLS; authenticated users have no direct access.
ALTER TABLE contract_events ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for authenticated users: data is surfaced via blockchain_logs (user-scoped)
-- RLS exception documented: backend service role writes events; users read via blockchain_logs

-- Event cursor for tracking last processed ledger
CREATE TABLE IF NOT EXISTS event_cursor (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_ledger INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT single_cursor CHECK (id = 1)
);

-- RLS for event_cursor
-- NOTE: event_cursor is a singleton system table managed exclusively by the backend
-- event listener service via service role. No user access is required or permitted.
ALTER TABLE event_cursor ENABLE ROW LEVEL SECURITY;

-- RLS exception documented: singleton system table, service role only, no user policies needed

-- Renewal approvals table
CREATE TABLE IF NOT EXISTS renewal_approvals (
  id BIGSERIAL PRIMARY KEY,
  blockchain_sub_id BIGINT NOT NULL,
  approval_id BIGINT NOT NULL,
  max_spend BIGINT NOT NULL,
  expires_at INTEGER NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  rejected BOOLEAN DEFAULT FALSE,
  rejection_reason INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(blockchain_sub_id, approval_id)
);

CREATE INDEX idx_renewal_approvals_sub_id ON renewal_approvals(blockchain_sub_id);

-- RLS for renewal_approvals
-- Users can read their own renewal approvals (joined via subscriptions.blockchain_sub_id).
-- Inserts/updates are performed by the backend service role only.
ALTER TABLE renewal_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "renewal_approvals_select_own"
  ON renewal_approvals FOR SELECT
  USING (
    blockchain_sub_id IN (
      SELECT blockchain_sub_id
      FROM public.subscriptions
      WHERE user_id = auth.uid()
        AND blockchain_sub_id IS NOT NULL
    )
  );

-- Add blockchain_sub_id to subscriptions if not exists
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS blockchain_sub_id BIGINT,
ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS executor_address VARCHAR(56);

CREATE INDEX IF NOT EXISTS idx_subscriptions_blockchain_sub_id ON subscriptions(blockchain_sub_id);
