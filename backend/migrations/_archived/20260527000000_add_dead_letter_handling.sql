-- Migration: Add dead-letter handling for webhooks and notification jobs
-- This migration adds dead-letter support for failed webhook deliveries and notification jobs
-- with replay history for duplicate protection and replay tracking

-- 1. Add dead-letter state to webhook_deliveries table
ALTER TABLE webhook_deliveries 
  ADD COLUMN IF NOT EXISTS dead_letter_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_dead_letter BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT;

-- Add index for dead-letter queries
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_dead_letter 
  ON webhook_deliveries(is_dead_letter) WHERE is_dead_letter = TRUE;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_dead_letter_at 
  ON webhook_deliveries(dead_letter_at);

-- 2. Create webhook_dead_letter_replays table for replay history and duplicate protection
CREATE TABLE IF NOT EXISTS webhook_dead_letter_replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_delivery_id UUID NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  replay_request_by UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed')),
  response_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_replays_delivery ON webhook_dead_letter_replays(webhook_delivery_id);
CREATE INDEX idx_webhook_replays_status ON webhook_dead_letter_replays(status);
CREATE INDEX idx_webhook_replays_idempotency ON webhook_dead_letter_replays(idempotency_key);

-- 3. Create notification_dead_letter_queue table for notification job failures
CREATE TABLE IF NOT EXISTS notification_dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('push', 'sms', 'email')),
  job_data JSONB NOT NULL,
  original_job_id TEXT NOT NULL UNIQUE,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error_message TEXT,
  last_error_code TEXT,
  dead_letter_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_dlq_user ON notification_dead_letter_queue(user_id);
CREATE INDEX idx_notification_dlq_created ON notification_dead_letter_queue(created_at);
CREATE INDEX idx_notification_dlq_type ON notification_dead_letter_queue(job_type);

-- 4. Create notification_dead_letter_replays table for notification job replay history
CREATE TABLE IF NOT EXISTS notification_dead_letter_replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_dlq_id UUID NOT NULL REFERENCES notification_dead_letter_queue(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  replay_request_by UUID REFERENCES auth.users(id),
  original_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'queued', 'success', 'failed')),
  error_message TEXT,
  error_code TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_replays_dlq ON notification_dead_letter_replays(notification_dlq_id);
CREATE INDEX idx_notification_replays_status ON notification_dead_letter_replays(status);
CREATE INDEX idx_notification_replays_idempotency ON notification_dead_letter_replays(idempotency_key);

-- 5. Create view for webhook dead-letter metrics
CREATE OR REPLACE VIEW webhook_dead_letter_stats AS
SELECT
  w.id as webhook_id,
  w.user_id,
  COUNT(DISTINCT wdl.id) as total_dead_letter_deliveries,
  COUNT(DISTINCT CASE WHEN wdl.dead_letter_at >= NOW() - INTERVAL '24 hours' THEN wdl.id END) as dead_letters_24h,
  COUNT(DISTINCT wdr.id) as total_replay_attempts,
  COUNT(DISTINCT CASE WHEN wdr.status = 'success' THEN wdr.id END) as successful_replays,
  MAX(wdl.dead_letter_at) as most_recent_dead_letter
FROM webhooks w
LEFT JOIN webhook_deliveries wdl ON w.id = wdl.webhook_id AND wdl.is_dead_letter = TRUE
LEFT JOIN webhook_dead_letter_replays wdr ON wdl.id = wdr.webhook_delivery_id
WHERE w.enabled = TRUE
GROUP BY w.id, w.user_id;

-- 6. Create view for notification dead-letter metrics
CREATE OR REPLACE VIEW notification_dead_letter_stats AS
SELECT
  user_id,
  job_type,
  COUNT(*) as total_dead_letters,
  COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as dead_letters_24h,
  COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as dead_letters_7d,
  ROUND(AVG(failure_count)::numeric, 2) as avg_failure_count
FROM notification_dead_letter_queue
GROUP BY user_id, job_type;

-- Add RLS policies for dead-letter tables if RLS is enabled
-- Webhook dead-letter replays - users can only see their own webhooks' replays
ALTER TABLE webhook_dead_letter_replays ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_replays_user_access ON webhook_dead_letter_replays
  FOR SELECT USING (
    webhook_delivery_id IN (
      SELECT wd.id FROM webhook_deliveries wd
      JOIN webhooks w ON wd.webhook_id = w.id
      WHERE w.user_id = auth.uid()
    )
  );

-- Notification dead-letter queue - users can only see their own
ALTER TABLE notification_dead_letter_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_dlq_user_access ON notification_dead_letter_queue
  FOR SELECT USING (user_id = auth.uid());

-- Notification dead-letter replays - users can only see their own
ALTER TABLE notification_dead_letter_replays ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_replays_user_access ON notification_dead_letter_replays
  FOR SELECT USING (
    notification_dlq_id IN (
      SELECT id FROM notification_dead_letter_queue
      WHERE user_id = auth.uid()
    )
  );
