-- Create table for storing notifications delayed due to quiet hours
CREATE TABLE delayed_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_schedule_id UUID NOT NULL REFERENCES reminder_schedules(id) ON DELETE CASCADE,
  notification_payload JSONB NOT NULL,
  original_send_time TIMESTAMPTZ NOT NULL,
  scheduled_send_time TIMESTAMPTZ NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  delay_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_delayed_notifications_user_id ON delayed_notifications(user_id);
CREATE INDEX idx_delayed_notifications_scheduled_send_time ON delayed_notifications(scheduled_send_time) WHERE status = 'pending';
CREATE INDEX idx_delayed_notifications_status ON delayed_notifications(status);

-- RLS policies
ALTER TABLE delayed_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own delayed notifications"
  ON delayed_notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "System can manage delayed notifications"
  ON delayed_notifications FOR ALL
  USING (true);

-- Trigger for updated_at
CREATE TRIGGER set_delayed_notifications_updated_at
  BEFORE UPDATE ON delayed_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Add comment
COMMENT ON TABLE delayed_notifications IS 'Stores notifications that were delayed due to user quiet hours settings';