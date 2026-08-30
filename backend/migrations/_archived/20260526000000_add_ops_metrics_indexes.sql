-- Migration: 20260526000000_add_ops_metrics_indexes.sql
-- Issue #99 — Async Ops Dashboard covering indexes
-- These indexes support efficient range queries used by the new MonitoringService
-- methods (getThroughputMetrics, getLatencyMetrics, getRetryMetrics, getFailedItems)
-- without requiring full-table scans on high-volume tables.

-- notification_deliveries: fast status-filtered range queries
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_created
    ON notification_deliveries(status, created_at DESC);

-- notification_deliveries: fast attempt_count distribution queries
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_attempt_count
    ON notification_deliveries(attempt_count, created_at DESC);

-- notification_deliveries: fast channel + window queries for throughput
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel_created
    ON notification_deliveries(channel, created_at DESC);

-- renewal_logs: fast status-filtered range queries
CREATE INDEX IF NOT EXISTS idx_renewal_logs_status_created
    ON renewal_logs(status, created_at DESC);

-- blockchain_logs: fast status-filtered range queries
CREATE INDEX IF NOT EXISTS idx_blockchain_logs_status_created
    ON blockchain_logs(status, created_at DESC);

-- reminder_schedules: fast updated_at range queries for throughput
CREATE INDEX IF NOT EXISTS idx_reminder_schedules_status_updated
    ON reminder_schedules(status, updated_at DESC);
