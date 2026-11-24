-- Add reminder_jitter_level to user_preferences
ALTER TABLE user_preferences 
ADD COLUMN IF NOT EXISTS reminder_jitter_level TEXT DEFAULT 'off' 
CHECK (reminder_jitter_level IN ('off', 'low', 'medium', 'high'));

-- Add jitter_offset_hours to reminder_schedules
ALTER TABLE reminder_schedules 
ADD COLUMN IF NOT EXISTS jitter_offset_hours NUMERIC;