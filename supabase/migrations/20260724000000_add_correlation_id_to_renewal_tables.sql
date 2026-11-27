-- Add correlation_id column to renewal-related tables for end-to-end tracing
-- Issue: Correlation ID propagation from client → backend → contract calls

-- Add correlation_id to renewal_logs
ALTER TABLE renewal_logs 
ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- Add correlation_id to subscription_renewal_attempts
ALTER TABLE subscription_renewal_attempts 
ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- Add correlation_id to renewal_dead_letter_queue
ALTER TABLE renewal_dead_letter_queue 
ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- Add correlation_id to renewal_attempts
ALTER TABLE renewal_attempts 
ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- Create indexes for efficient correlation ID lookups
CREATE INDEX IF NOT EXISTS idx_renewal_logs_correlation_id ON renewal_logs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_subscription_renewal_attempts_correlation_id ON subscription_renewal_attempts(correlation_id);
CREATE INDEX IF NOT EXISTS idx_renewal_dead_letter_queue_correlation_id ON renewal_dead_letter_queue(correlation_id);
CREATE INDEX IF NOT EXISTS idx_renewal_attempts_correlation_id ON renewal_attempts(correlation_id);

-- Add comments for documentation
COMMENT ON COLUMN renewal_logs.correlation_id IS 'Correlation ID for tracing requests from client through backend to blockchain';
COMMENT ON COLUMN subscription_renewal_attempts.correlation_id IS 'Correlation ID for tracing renewal attempts across systems';
COMMENT ON COLUMN renewal_dead_letter_queue.correlation_id IS 'Correlation ID for debugging failed renewals';
COMMENT ON COLUMN renewal_attempts.correlation_id IS 'Correlation ID for linking renewal attempts to originating requests';
