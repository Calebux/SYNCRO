-- Unified inbound webhook ingestion pipeline (issue #1283).
--
-- Before this, five webhook route files each implemented their own signature
-- verification, deduplication, persistence and error handling. The stored event
-- row is now both the audit record and the work queue: a delivery is persisted
-- and acknowledged, then processed asynchronously, so a handler failure retries
-- from our side instead of asking the provider to redeliver.

-- The table originated in client/scripts/022_create_webhook_events.sql, which
-- never became a tracked migration. Create it if absent so the backend and the
-- migration history agree.
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Deduplication is scoped by (provider, event_id): two providers may legitimately
-- issue the same event id, and scoping by event_id alone silently drops one.
ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_provider_event_id_unique;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_provider_event_id_unique UNIQUE (provider, event_id);

-- Queue state carried on the stored record.
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_status_check;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_status_check
  CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'dead_letter'));

-- Backfill status from the legacy `processed` flag so existing rows are not
-- re-processed by the new sweeper.
UPDATE public.webhook_events
SET status = 'processed'
WHERE processed IS TRUE AND status = 'pending';

-- The sweeper's hot query: due work, oldest first.
CREATE INDEX IF NOT EXISTS idx_webhook_events_due
  ON public.webhook_events (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_status
  ON public.webhook_events (provider, status, created_at DESC);

COMMENT ON COLUMN public.webhook_events.status IS
  'Queue state. The stored row is the work queue: pending -> processing -> processed/failed -> dead_letter.';

-- ── Rejected deliveries ─────────────────────────────────────────────────────
-- A delivery that fails signature verification must persist nothing beyond an
-- audit record: the payload is untrusted and unverified, so only metadata is
-- retained, never the body.
CREATE TABLE IF NOT EXISTS public.webhook_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  reason TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  source_ip TEXT,
  -- Size only; the unverified body itself is deliberately not stored.
  payload_bytes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_rejections_provider_created
  ON public.webhook_rejections (provider, created_at DESC);

COMMENT ON TABLE public.webhook_rejections IS
  'Audit trail of webhook deliveries rejected before persistence (issue #1283). Never stores the unverified body.';

-- ── Operator replays ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id UUID NOT NULL REFERENCES public.webhook_events(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  outcome TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_replays_event
  ON public.webhook_replays (webhook_event_id, created_at DESC);

COMMENT ON TABLE public.webhook_replays IS
  'Audit trail of operator-triggered webhook event replays (issue #1283).';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- All three tables are operator-only. The backend writes with the service role,
-- which bypasses RLS; the authenticated role gets read access for owners only.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_replays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_events_owner_select" ON public.webhook_events;
CREATE POLICY "webhook_events_owner_select"
  ON public.webhook_events FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin'))
  );

DROP POLICY IF EXISTS "webhook_rejections_owner_select" ON public.webhook_rejections;
CREATE POLICY "webhook_rejections_owner_select"
  ON public.webhook_rejections FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin'))
  );

DROP POLICY IF EXISTS "webhook_replays_owner_select" ON public.webhook_replays;
CREATE POLICY "webhook_replays_owner_select"
  ON public.webhook_replays FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('owner', 'admin'))
  );
