-- Issue #1855: durable, versioned provider analytics delivery.
create table if not exists public.provider_usage_event_outbox (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null default '1.0.0',
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists idx_provider_usage_events_pending
  on public.provider_usage_event_outbox (available_at, created_at)
  where status <> 'delivered';

alter table public.provider_usage_event_outbox enable row level security;
create policy "service role manages provider usage event outbox"
  on public.provider_usage_event_outbox for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create or replace function public.enqueue_provider_usage_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from 'committed' and new.status = 'committed' then
    insert into public.provider_usage_event_outbox (payload)
    values (jsonb_build_object(
      'type', 'usage.committed',
      'occurredAt', new.committed_at,
      'agentId', new.agent_id,
      'route', new.route,
      'unitName', new.unit_name,
      'units', new.actual_units::text,
      'amount', new.actual_amount::text
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists meter_usage_ledger_provider_event on public.meter_usage_ledger;
create trigger meter_usage_ledger_provider_event
  after update of status on public.meter_usage_ledger
  for each row execute function public.enqueue_provider_usage_event();

create or replace function public.claim_provider_usage_events(p_limit integer default 100)
returns setof public.provider_usage_event_outbox
language sql security definer set search_path = public as $$
  with candidates as (
    select id from public.provider_usage_event_outbox
    where status <> 'delivered' and available_at <= now()
      and (locked_until is null or locked_until < now())
    order by created_at, id
    for update skip locked
    limit greatest(1, least(p_limit, 1000))
  )
  update public.provider_usage_event_outbox e
     set status = 'processing', locked_until = now() + interval '1 minute', attempts = attempts + 1
    from candidates c where e.id = c.id
  returning e.*;
$$;

revoke all on function public.claim_provider_usage_events(integer) from public, anon, authenticated;
grant execute on function public.claim_provider_usage_events(integer) to service_role;
