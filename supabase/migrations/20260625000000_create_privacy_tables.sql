-- Create privacy_preferences table
CREATE TABLE IF NOT EXISTS public.privacy_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  privacy_mode BOOLEAN NOT NULL DEFAULT false,
  stealth_addresses BOOLEAN NOT NULL DEFAULT false,
  encrypt_on_chain BOOLEAN NOT NULL DEFAULT false,
  payment_channels BOOLEAN NOT NULL DEFAULT false,
  reminder_jitter BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on privacy_preferences
ALTER TABLE public.privacy_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for privacy_preferences
CREATE POLICY "privacy_preferences_select_own"
  ON public.privacy_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "privacy_preferences_insert_own"
  ON public.privacy_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "privacy_preferences_update_own"
  ON public.privacy_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger for privacy_preferences updated_at
CREATE TRIGGER set_privacy_updated_at
  BEFORE UPDATE ON public.privacy_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Create global_privacy_flags table
CREATE TABLE IF NOT EXISTS public.global_privacy_flags (
  flag_name TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on global_privacy_flags
ALTER TABLE public.global_privacy_flags ENABLE ROW LEVEL SECURITY;

-- Anyone (authenticated or anon) can read global flags
CREATE POLICY "global_privacy_flags_select"
  ON public.global_privacy_flags FOR SELECT
  USING (true);

-- Authenticated users (admin simulation) can insert/update global flags
CREATE POLICY "global_privacy_flags_all_auth"
  ON public.global_privacy_flags FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert default global flags
INSERT INTO public.global_privacy_flags (flag_name, enabled) VALUES
  ('PRIVACY_ZK_PROOFS', false),
  ('PRIVACY_AUDIT_COMMITMENTS', false),
  ('PRIVACY_SETTLEMENT_BATCHING', false)
ON CONFLICT (flag_name) DO NOTHING;

-- Also insert defaults for per-user flags into global settings as system fallback defaults
INSERT INTO public.global_privacy_flags (flag_name, enabled) VALUES
  ('PRIVACY_STEALTH_ADDRESSES', false),
  ('PRIVACY_ENCRYPT_ON_CHAIN', false),
  ('PRIVACY_PAYMENT_CHANNELS', false),
  ('PRIVACY_REMINDER_JITTER', false)
ON CONFLICT (flag_name) DO NOTHING;
