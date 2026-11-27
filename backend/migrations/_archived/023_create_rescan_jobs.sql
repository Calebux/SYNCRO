CREATE TABLE IF NOT EXISTS rescan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  processed_count INTEGER NOT NULL DEFAULT 0,
  subscriptions_created INTEGER NOT NULL DEFAULT 0,
  duplicates_skipped INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  initiated_by UUID REFERENCES auth.users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rescan_jobs_status_check CHECK (status IN ('in_progress', 'completed', 'failed')),
  CONSTRAINT rescan_jobs_date_range_check CHECK (start_date <= end_date),
  CONSTRAINT rescan_jobs_counts_check CHECK (
    processed_count >= 0
    AND subscriptions_created >= 0
    AND duplicates_skipped >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_rescan_jobs_user_id ON rescan_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_rescan_jobs_email_account_id ON rescan_jobs(email_account_id);
CREATE INDEX IF NOT EXISTS idx_rescan_jobs_status ON rescan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_rescan_jobs_created_at ON rescan_jobs(created_at DESC);

ALTER TABLE rescan_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rescan_jobs_select_own ON rescan_jobs;
CREATE POLICY rescan_jobs_select_own
  ON rescan_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS rescan_jobs_insert_own ON rescan_jobs;
CREATE POLICY rescan_jobs_insert_own
  ON rescan_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS rescan_jobs_update_own ON rescan_jobs;
CREATE POLICY rescan_jobs_update_own
  ON rescan_jobs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
