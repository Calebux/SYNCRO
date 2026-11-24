-- Add privacy_mode_enabled and encryption_key to user_preferences
alter table public.user_preferences
  add column if not exists privacy_mode_enabled boolean not null default false,
  add column if not exists encryption_key text;

-- Update existing users
update public.user_preferences
  set privacy_mode_enabled = false
  where privacy_mode_enabled is null;
