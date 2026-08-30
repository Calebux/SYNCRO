-- 1. Add Slack webhook URL to teams
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;

-- 2. Add budget columns to profiles (if profiles table exists)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS monthly_budget DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS budget_alert_threshold INT DEFAULT 80;

-- 3. Track sent budget alerts to prevent duplicates
CREATE TABLE IF NOT EXISTS public.budget_alert_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('budget_warning', 'budget_exceeded')),
  month TEXT NOT NULL, -- YYYY-MM
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, alert_type, month)
);

ALTER TABLE public.budget_alert_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_alert_logs_own"
  ON public.budget_alert_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS budget_alert_logs_user_month_idx
  ON public.budget_alert_logs(user_id, month);
