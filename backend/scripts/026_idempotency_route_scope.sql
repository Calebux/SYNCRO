-- Scope idempotency keys to a route and fix the uniqueness guarantee.
-- See supabase/migrations/20260830000000_idempotency_route_scope.sql
-- for the full explanation.

alter table public.idempotency_keys
  add column if not exists route text not null default 'unknown';

alter table public.idempotency_keys
  alter column route drop default;

drop index if exists public.idempotency_keys_unique_idx;

create unique index if not exists idempotency_keys_key_user_route_idx
  on public.idempotency_keys (key, user_id, route);

create index if not exists idempotency_keys_key_user_hash_idx
  on public.idempotency_keys (key, user_id, request_hash);
