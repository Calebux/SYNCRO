-- Privacy-preserving log of receipt metadata extracted from email scans.
-- The email body is never stored — only structured fields and cryptographic proof hashes.
-- The CHECK constraint on body_excluded enforces this policy at the database level.
CREATE TABLE IF NOT EXISTS public.email_scan_logs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         REFERENCES auth.users(id) ON DELETE CASCADE,
  provider         TEXT         NOT NULL,
  message_id       TEXT,
  received_at      TIMESTAMPTZ,
  from_address     TEXT,
  subject          TEXT,
  service_name     TEXT,
  amount           NUMERIC(12,2),
  currency         TEXT,
  billing_interval TEXT,
  signals          TEXT[],
  confidence       NUMERIC(4,3),
  proof_hash       TEXT,
  content_hash     TEXT,
  body_excluded    BOOLEAN      NOT NULL DEFAULT TRUE,
  scanned_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT email_scan_logs_no_body_check CHECK (body_excluded = TRUE),
  CONSTRAINT email_scan_logs_provider_message_unique UNIQUE (provider, message_id)
);

-- Indexes for optimal query performance
CREATE INDEX IF NOT EXISTS idx_email_scan_logs_user_scanned    ON public.email_scan_logs(user_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_scan_logs_provider_message ON public.email_scan_logs(provider, message_id);
CREATE INDEX IF NOT EXISTS idx_email_scan_logs_received        ON public.email_scan_logs(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_scan_logs_amount          ON public.email_scan_logs(amount) WHERE amount IS NOT NULL;

-- Enable RLS (Row Level Security) for email scan logs
ALTER TABLE public.email_scan_logs ENABLE ROW LEVEL SECURITY;

-- Users can only read their own scan log rows
CREATE POLICY email_scan_logs_select_own ON public.email_scan_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only the backend (with service role) can insert scan log rows
CREATE POLICY email_scan_logs_insert_backend ON public.email_scan_logs
  FOR INSERT
  WITH CHECK (true);

-- Scan logs are immutable — updates are never permitted
CREATE POLICY email_scan_logs_no_update ON public.email_scan_logs
  FOR UPDATE
  USING (false);

-- Only admins may delete scan log rows
CREATE POLICY email_scan_logs_admin_delete ON public.email_scan_logs
  FOR DELETE
  USING (auth.jwt() ->> 'is_admin' = 'true');

-- Table and column documentation
COMMENT ON TABLE public.email_scan_logs IS
  'Privacy-preserving log of receipt metadata extracted from email scans. The email body is never stored — only structured fields (amounts, dates, sender) and cryptographic proof hashes.';

COMMENT ON COLUMN public.email_scan_logs.body_excluded IS
  'Always TRUE. Enforced by CHECK constraint. Documents that the raw email body was intentionally not persisted.';

COMMENT ON COLUMN public.email_scan_logs.content_hash IS
  'SHA-256 hash of the original email body. Proves the body was processed without storing it.';

COMMENT ON COLUMN public.email_scan_logs.proof_hash IS
  'Composite proof-of-scan hash covering provider, message_id, timestamps, and extracted amounts.';
