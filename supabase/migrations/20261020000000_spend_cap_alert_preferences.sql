ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS spend_cap_alert_channels text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_spend_cap_alert_channels_valid
  CHECK (spend_cap_alert_channels <@ ARRAY['email', 'telegram']::text[]);

CREATE TABLE IF NOT EXISTS public.spend_cap_alert_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  threshold integer NOT NULL CHECK (threshold IN (80, 100)),
  notification_channel text NOT NULL CHECK (notification_channel IN ('email', 'telegram')),
  period_start date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel_id, threshold, period_start, notification_channel)
);

ALTER TABLE public.spend_cap_alert_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY spend_cap_alert_logs_service_role
  ON public.spend_cap_alert_logs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
