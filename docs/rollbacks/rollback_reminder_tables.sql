-- ============================================================
-- ROLLBACK: Reminder & Notification Tables
-- Covers migrations:
--   supabase/migrations/20240107000000_create_reminder_tables.sql
--   backend/migrations/020_create_delayed_notifications.sql
--   supabase/migrations/20260427000000_create_reminder_settings.sql
-- Risk: HIGH — drops active reminder schedules and delivery history
-- ============================================================

-- ── VERIFICATION (run before rollback) ──────────────────────
-- Check for in-flight reminders that would be lost:
--
--   SELECT status, COUNT(*) FROM reminder_schedules GROUP BY status;
--   SELECT status, COUNT(*) FROM notification_deliveries GROUP BY status;
--   SELECT status, COUNT(*) FROM delayed_notifications GROUP BY status;
--
-- Safe-to-rollback state:
--   No rows with status = 'pending' in reminder_schedules
--   No rows with status IN ('pending', 'retrying') in notification_deliveries
--   No rows with status = 'pending' in delayed_notifications

-- ── ROLLBACK ────────────────────────────────────────────────

BEGIN;

-- 1. Drop delayed_notifications (depends on reminder_schedules FK)
DROP TABLE IF EXISTS delayed_notifications CASCADE;

-- 2. Drop notification_deliveries (depends on reminder_schedules FK)
DROP TABLE IF EXISTS public.notification_deliveries CASCADE;

-- 3. Drop blockchain_logs (created in same migration, no dependents)
DROP TABLE IF EXISTS public.blockchain_logs CASCADE;

-- 4. Drop reminder_schedules
DROP TABLE IF EXISTS public.reminder_schedules CASCADE;

-- 5. Drop reminder_settings
DROP TABLE IF EXISTS public.reminder_settings CASCADE;
DROP TRIGGER IF EXISTS set_updated_at_reminder_settings ON public.reminder_settings;

-- ── POST-ROLLBACK VERIFICATION ───────────────────────────────
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN (
--       'reminder_schedules', 'notification_deliveries',
--       'blockchain_logs', 'delayed_notifications', 'reminder_settings'
--     );
--   -- Expected: 0 rows

COMMIT;
