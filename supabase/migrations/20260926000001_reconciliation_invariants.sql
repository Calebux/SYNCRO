-- supabase/migrations/20260926000000_reconciliation_invariants.sql
--
-- Place at: supabase/migrations/20260926000000_reconciliation_invariants.sql
-- Run with: supabase db push  (or however this repo applies migrations —
-- check docs/ENVIRONMENT.md / supabase/ for the existing convention first)

create table if not exists reconciliation_discrepancies (
  id uuid primary key default gen_random_uuid(),
  detected_at timestamptz not null default now(),
  invariant text not null,
  discrepancy_type text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  renewal_record_id uuid null,
  tx_hash text null,
  contract_id text null,
  backend_amount text null,
  on_chain_amount text null,
  details jsonb not null default '{}'::jsonb,
  resolution_action text not null,
  resolution_status text not null default 'pending'
    check (resolution_status in ('pending', 'auto_resolved', 'resolved', 'unresolved')),
  resolved_at timestamptz null,
  resolution_notes text null
);

create index if not exists idx_reconciliation_discrepancies_status
  on reconciliation_discrepancies (resolution_status);
create index if not exists idx_reconciliation_discrepancies_detected_at
  on reconciliation_discrepancies (detected_at desc);
create index if not exists idx_reconciliation_discrepancies_tx_hash
  on reconciliation_discrepancies (tx_hash);

create table if not exists reconciliation_runs (
  id uuid primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  mode text not null check (mode in ('sliding_window', 'full_sweep')),
  window_start timestamptz null,
  window_end timestamptz null,
  records_checked integer not null default 0,
  discrepancies_found integer not null default 0,
  reconciliation_lag_ms bigint not null default 0
);

create index if not exists idx_reconciliation_runs_finished_at
  on reconciliation_runs (finished_at desc);

-- ADJUST: if this repo relies on RLS for every table (check other
-- migrations under supabase/migrations/ for the convention), add matching
-- policies here restricting access to the service role / ops role only —
-- this data must not be readable by end users.
alter table reconciliation_discrepancies enable row level security;
alter table reconciliation_runs enable row level security;

create policy "service role full access - discrepancies"
  on reconciliation_discrepancies for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role full access - runs"
  on reconciliation_runs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');