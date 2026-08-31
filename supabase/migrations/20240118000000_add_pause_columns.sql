-- Add pause-related columns to subscriptions table
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paused_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS resume_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pause_reason TEXT        DEFAULT NULL;

-- Fast lookup for auto-resume job
CREATE INDEX IF NOT EXISTS idx_subscriptions_resume_at
  ON public.subscriptions (status, resume_at)
  WHERE status = 'paused' AND resume_at IS NOT NULL;
