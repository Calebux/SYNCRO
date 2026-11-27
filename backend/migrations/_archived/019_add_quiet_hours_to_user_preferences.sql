-- Add quiet hours support to user preferences
-- This allows users to set time periods when only critical alerts pass through

ALTER TABLE public.user_preferences 
ADD COLUMN quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN quiet_hours_start TIME NOT NULL DEFAULT '22:00:00',
ADD COLUMN quiet_hours_end TIME NOT NULL DEFAULT '08:00:00',
ADD COLUMN quiet_hours_timezone TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN critical_alerts_only BOOLEAN NOT NULL DEFAULT TRUE;

-- Add index for efficient quiet hours queries
CREATE INDEX idx_user_preferences_quiet_hours 
ON public.user_preferences(quiet_hours_enabled, quiet_hours_start, quiet_hours_end) 
WHERE quiet_hours_enabled = TRUE;

-- Add comment explaining the feature
COMMENT ON COLUMN public.user_preferences.quiet_hours_enabled IS 'Whether quiet hours are active for this user';
COMMENT ON COLUMN public.user_preferences.quiet_hours_start IS 'Start time for quiet hours (24-hour format)';
COMMENT ON COLUMN public.user_preferences.quiet_hours_end IS 'End time for quiet hours (24-hour format)';
COMMENT ON COLUMN public.user_preferences.quiet_hours_timezone IS 'Timezone for quiet hours (IANA timezone identifier)';
COMMENT ON COLUMN public.user_preferences.critical_alerts_only IS 'Whether to allow only critical alerts during quiet hours';