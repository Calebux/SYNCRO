-- Migration 027: settlement_reconciliation_runs
-- Stores the output of every three-way (meter / engine / chain) reconciliation run.

create table if not exists settlement_reconciliation_runs (
  id                        bigserial primary key,
  run_id                    uuid         not null unique default gen_random_uuid(),
  started_at                timestamptz  not null,
  completed_at              timestamptz,
  tolerance_pct             numeric(6,4) not null default 1.0,
  total_channels            int          not null default 0,
  channels_out_of_tolerance int          not null default 0,
  deltas_by_cause           jsonb        not null default '{}',
  blocked                   boolean      not null default false,
  run_error                 text,
  -- Full per-channel breakdown stored as JSONB for ad-hoc queries.
  -- Schema mirrors ChannelReconciliation[] from settlement-reconciliation-service.ts
  channel_details           jsonb        not null default '[]',
  created_at                timestamptz  not null default now()
);

-- Fast lookup by recency and blocked status (ops dashboard queries)
create index if not exists idx_srr_started_at
  on settlement_reconciliation_runs (started_at desc);

create index if not exists idx_srr_blocked
  on settlement_reconciliation_runs (blocked)
  where blocked = true;

-- RLS: only service-role / admin can read reconciliation runs
alter table settlement_reconciliation_runs enable row level security;

create policy "service_role_all" on settlement_reconciliation_runs
  for all
  using (auth.role() = 'service_role');
