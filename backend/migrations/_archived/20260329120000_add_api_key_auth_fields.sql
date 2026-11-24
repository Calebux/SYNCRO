-- Add fields for API key auth, scopes, and usage tracking
alter table public.api_keys
  add column if not exists key_hash text,
  add column if not exists scopes text[] default '{}' not null,
  add column if not exists revoked boolean default false not null,
  add column if not exists last_used_at timestamptz,
  add column if not exists request_count integer default 0 not null;

alter table public.api_keys
  add constraint if not exists api_keys_key_hash_unique unique(key_hash);
