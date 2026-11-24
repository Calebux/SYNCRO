-- Migration: Add TOTP used codes tracking for replay prevention
-- Purpose: Ensure TOTP codes are single-use within their time window

-- Table to track used TOTP codes and prevent replay attacks
create table public.totp_used_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null, -- SHA-256 hash of the code
  time_window bigint not null, -- Unix timestamp of the 30-second window
  used_at     timestamptz not null default now(),
  expires_at  timestamptz not null -- Auto-cleanup after 2 minutes
);

-- Index for efficient lookup by user and time window
create index totp_used_codes_user_window_idx on public.totp_used_codes(user_id, time_window);

-- Index for cleanup of expired records
create index totp_used_codes_expires_at_idx on public.totp_used_codes(expires_at);

-- CRITICAL: Unique constraint to prevent race conditions in concurrent requests
-- This ensures database-level enforcement that a code can only be used once
alter table public.totp_used_codes
  add constraint totp_used_codes_unique_usage
  unique (user_id, code_hash, time_window);

-- Enable RLS
alter table public.totp_used_codes enable row level security;

-- Only service role can manage TOTP used codes (security-sensitive)
create policy "totp_used_codes_service_only"
  on public.totp_used_codes
  using (false);

-- Function to automatically clean up expired TOTP records
create or replace function public.cleanup_expired_totp_codes()
returns void
language plpgsql
security definer
as $$
begin
  delete from public.totp_used_codes
  where expires_at < now();
end;
$$;

-- Note: Schedule this function to run periodically via pg_cron or a background job
-- Example: SELECT cron.schedule('cleanup-totp', '*/5 * * * *', 'SELECT cleanup_expired_totp_codes()');

