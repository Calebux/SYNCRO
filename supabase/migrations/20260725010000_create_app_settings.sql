-- Platform-wide admin settings (singleton row)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id TEXT PRIMARY KEY DEFAULT 'platform',
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  enable_registration BOOLEAN NOT NULL DEFAULT true,
  rate_limit_threshold INTEGER NOT NULL DEFAULT 100 CHECK (rate_limit_threshold > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (id)
VALUES ('platform')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Owners (profiles.role) may read/write platform settings.
-- API layer still enforces requireRole(['owner']).
DROP POLICY IF EXISTS "app_settings_owner_all" ON public.app_settings;
CREATE POLICY "app_settings_owner_all"
  ON public.app_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );
