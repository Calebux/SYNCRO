-- ============================================================================
-- Migration 025: Contract Upgrade Governance Tables
-- Tracks upgrade proposals, guardian approvals, timelocks, and rollbacks.
-- ============================================================================

-- Upgrade proposals tracked off-chain for reference and indexing
create table if not exists public.contract_upgrade_proposals (
  id bigserial primary key,
  proposal_id bigint not null,                        -- on-chain proposal ID
  target_contract text not null,                      -- contract address being upgraded
  new_wasm_hash text not null,                        -- SHA-256 of new WASM
  previous_wasm_hash text not null,                   -- SHA-256 of old WASM (for rollback)
  description text not null default '',               -- human-readable changelog
  proposer text not null,                             -- guardian who proposed
  state text not null default 'Pending'
    check (state in ('Pending','Approved','Ready','Executed','Cancelled','RolledBack')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  executable_at timestamptz,
  executed_at timestamptz,
  transaction_hash text,
  unique(proposal_id)
);

-- Upgrade lifecycle events
create table if not exists public.contract_upgrade_events (
  id bigserial primary key,
  proposal_id bigint not null default 0,
  event_type text not null
    check (event_type in ('proposed','approved','ready','executed','rolled_back','cancelled')),
  transaction_hash text,
  data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Guardian set snapshots for audit trail
create table if not exists public.contract_upgrade_guardians (
  id bigserial primary key,
  guardian_address text not null,
  active boolean not null default true,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);

-- Indexes
create index if not exists upgrade_proposals_state_idx
  on public.contract_upgrade_proposals(state);
create index if not exists upgrade_events_proposal_id_idx
  on public.contract_upgrade_events(proposal_id);
create index if not exists upgrade_events_type_idx
  on public.contract_upgrade_events(event_type);
create index if not exists upgrade_guardians_active_idx
  on public.contract_upgrade_guardians(active);

-- Enable RLS
alter table public.contract_upgrade_proposals enable row level security;
alter table public.contract_upgrade_events enable row level security;
alter table public.contract_upgrade_guardians enable row level security;

-- RLS policies: admin-only write, authenticated users can read
create policy "Admins can manage upgrade proposals"
  on public.contract_upgrade_proposals
  for all
  using (auth.role() = 'service_role');

create policy "Authenticated users can view upgrade proposals"
  on public.contract_upgrade_proposals
  for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage upgrade events"
  on public.contract_upgrade_events
  for all
  using (auth.role() = 'service_role');

create policy "Authenticated users can view upgrade events"
  on public.contract_upgrade_events
  for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage upgrade guardians"
  on public.contract_upgrade_guardians
  for all
  using (auth.role() = 'service_role');

create policy "Authenticated users can view upgrade guardians"
  on public.contract_upgrade_guardians
  for select
  using (auth.role() = 'authenticated');
