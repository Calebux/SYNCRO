-- Add unique constraint to reminder_schedules to prevent duplicates and enable batch upserts
ALTER TABLE public.reminder_schedules
ADD CONSTRAINT reminder_schedules_subscription_id_reminder_date_key UNIQUE (subscription_id, reminder_date);
