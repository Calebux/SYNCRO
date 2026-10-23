-- Domain event outbox for the internal event bus.
--
-- Events are written inside the originating transaction so the action and the
-- event are atomically committed. A background poller dispatches pending rows
-- to registered subscribers. Failures are retried with exponential backoff
-- and moved to domain_event_dead_letter after exhaustion.

CREATE TABLE IF NOT EXISTS public.domain_event_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  event_payload JSONB NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  correlation_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.domain_event_dead_letter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  event_payload JSONB NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  correlation_id TEXT,
  retry_count INTEGER NOT NULL,
  last_error TEXT,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_status_next
  ON public.domain_event_outbox (status, next_retry_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_created
  ON public.domain_event_outbox (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_user
  ON public.domain_event_outbox (user_id, created_at DESC);

ALTER TABLE public.domain_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_event_dead_letter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "domain_event_outbox_service_write" ON public.domain_event_outbox;
CREATE POLICY "domain_event_outbox_service_write"
  ON public.domain_event_outbox
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "domain_event_dead_letter_service_write" ON public.domain_event_dead_letter;
CREATE POLICY "domain_event_dead_letter_service_write"
  ON public.domain_event_dead_letter
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.domain_event_outbox IS
  'Reliable outbox for internal domain events. Subscribers consume via background poller.';
COMMENT ON TABLE public.domain_event_dead_letter IS
  'Dead-letter queue for domain events that exhausted retries.';
