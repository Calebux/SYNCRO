-- supabase/migrations/20240101000000_add_subscription_notification_preferences.sql

CREATE TABLE subscription_notification_preferences (
  subscription_id UUID PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
  reminder_days_before INT[] NOT NULL DEFAULT '{7,3,1}',
  channels TEXT[] NOT NULL DEFAULT '{email}',
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  muted_until TIMESTAMPTZ DEFAULT NULL,
  custom_message TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the cron job that auto-unmutes expired snoozes
CREATE INDEX idx_snp_muted_until 
  ON subscription_notification_preferences(muted_until) 
  WHERE muted_until IS NOT NULL;

-- RLS: users can only see/modify preferences for their own subscriptions
ALTER TABLE subscription_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own notification preferences"
  ON subscription_notification_preferences
  FOR ALL
  USING (
    subscription_id IN (
      SELECT id FROM subscriptions WHERE user_id = auth.uid()
    )
  );