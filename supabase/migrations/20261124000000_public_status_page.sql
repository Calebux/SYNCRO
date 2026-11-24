CREATE TABLE IF NOT EXISTS public.status_incidents (
  id uuid,
  title text,
  impact text,
  components text[],
  created_at timestamptz,
  PRIMARY KEY (id),
  CHECK (char_length(title) BETWEEN 1 AND 160),
  CHECK (impact IN ('minor', 'major', 'critical')),
  CHECK (
    cardinality(components) BETWEEN 1 AND 3
    AND components <@ ARRAY['gateway', 'settlement', 'soroban_rpc']::text[]
  )
);

ALTER TABLE public.status_incidents
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN impact SET NOT NULL,
  ALTER COLUMN components SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_status_incidents_created_at
  ON public.status_incidents (created_at DESC);

CREATE TABLE IF NOT EXISTS public.status_incident_updates (
  id uuid,
  incident_id uuid,
  status text,
  message text,
  created_at timestamptz,
  PRIMARY KEY (id),
  FOREIGN KEY (incident_id) REFERENCES public.status_incidents(id) ON DELETE CASCADE,
  CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  CHECK (char_length(message) BETWEEN 1 AND 4000)
);

ALTER TABLE public.status_incident_updates
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN incident_id SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN message SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_status_incident_updates_timeline
  ON public.status_incident_updates (incident_id, created_at);

CREATE TABLE IF NOT EXISTS public.status_subscribers (
  email text,
  confirmation_token_hash text,
  confirmation_expires_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz,
  PRIMARY KEY (email),
  UNIQUE (confirmation_token_hash),
  CHECK (char_length(email) BETWEEN 3 AND 254),
  CHECK (
    (confirmed_at IS NOT NULL AND confirmation_token_hash IS NULL AND confirmation_expires_at IS NULL)
    OR (confirmed_at IS NULL AND confirmation_token_hash IS NOT NULL AND confirmation_expires_at IS NOT NULL)
  )
);

ALTER TABLE public.status_subscribers
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.status_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_incident_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY status_incidents_service_role
  ON public.status_incidents FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY status_incident_updates_service_role
  ON public.status_incident_updates FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY status_subscribers_service_role
  ON public.status_subscribers FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.status_incidents, public.status_incident_updates, public.status_subscribers
  FROM anon, authenticated;
GRANT ALL ON public.status_incidents, public.status_incident_updates, public.status_subscribers
  TO service_role;
