CREATE TABLE IF NOT EXISTS public.v3_receipts (
  receipt_id text PRIMARY KEY,
  channel_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_receipts_retention
  ON public.v3_receipts (issued_at);
CREATE INDEX IF NOT EXISTS idx_v3_receipts_channel
  ON public.v3_receipts (channel_id);

ALTER TABLE public.v3_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY v3_receipts_service_role
  ON public.v3_receipts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.usage_retention_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL CHECK (source_table IN ('v3_receipts', 'meter_usage_ledger', 'channel_payments')),
  source_id text NOT NULL,
  archived_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (source_table, source_id)
);

ALTER TABLE public.usage_retention_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_retention_archive_service_role
  ON public.usage_retention_archive FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
