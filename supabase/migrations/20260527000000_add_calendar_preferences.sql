-- Calendar sync preferences for iCal feed export
ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS calendar_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS calendar_export_reminders BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.user_preferences.calendar_sync_enabled IS 'Whether the user iCal calendar feed is active';
COMMENT ON COLUMN public.user_preferences.calendar_export_reminders IS 'Whether pending reminder schedules are included in the iCal feed';
