-- subscriptions table
-- Used by: all subscription list endpoints, reminder engine, risk recalculation
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);

-- Used by: reminder engine to find upcoming renewals
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_renewal ON subscriptions(next_renewal_date) 
WHERE status = 'active';

-- Used by: auto-expiry service
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_billing ON subscriptions(user_id, billing_cycle);

-- reminder_schedules table
-- Used by: daily cron job to find due reminders
CREATE INDEX IF NOT EXISTS idx_reminder_schedules_date_status ON reminder_schedules(reminder_date, status);

-- Used by: deleteSubscription cleanup
CREATE INDEX IF NOT EXISTS idx_reminder_schedules_subscription ON reminder_schedules(subscription_id);

-- blockchain_logs table
-- Used by: getAgentActivity() admin query
CREATE INDEX IF NOT EXISTS idx_blockchain_logs_created_at ON blockchain_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blockchain_logs_subscription ON blockchain_logs(subscription_id);

-- idempotency_keys table
-- Used by: cleanupExpired() and lookup by request hash
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);
