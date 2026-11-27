-- supabase/migrations/20261005000000_usage_reconciliation.sql
--
-- Issue #1445 — durable reconciliation of usage that was served but not
-- correctly accounted for: degraded-mode metering, crashes between reserve
-- and commit, and settlement failures.
--
-- Three tables:
--
--   meter_usage_ledger        one row per served call, carrying the whole
--                             reserve -> commit -> settle lifecycle. This is
--                             the "served" ledger and the source of truth for
--                             orphaned-reservation detection.
--   degraded_usage_log        durable queue of usage that could not be applied
--                             to the meter at the time it was served (degraded
--                             mode, or a failed meter write). Drained by the
--                             daily reconciliation job. `reservation_id` is
--                             the idempotency key that makes a partially
--                             replayed log safe.
--   usage_reconciliation_reports
--                             the per-window report: served / metered /
--                             settled and the three deltas between them.
--
-- Money columns are `numeric` (never float) to preserve exact amounts.

-- ---------------------------------------------------------------------------
-- meter_usage_ledger
-- ---------------------------------------------------------------------------
create table if not exists meter_usage_ledger (
  id                  uuid primary key default gen_random_uuid(),

  -- Natural key of the served call. Unique so a retried commit for the same
  -- reservation can never produce a second ledger row.
  reservation_id      text not null unique,

  agent_id            text not null,
  route               text not null,
  unit_name           text not null,

  -- 'reserved'  -> request accepted, usage not yet known
  -- 'committed' -> usage known and delivered (the request was served)
  -- 'released'  -> usage never delivered (upstream error, disconnect, etc.)
  -- 'expired'   -> reservation outlived its TTL without a terminal transition
  status              text not null default 'reserved'
                        check (status in ('reserved', 'committed', 'released', 'expired')),

  reserved_units      numeric not null default 0 check (reserved_units >= 0),
  reserved_amount     numeric not null default 0 check (reserved_amount >= 0),

  actual_units        numeric null check (actual_units is null or actual_units >= 0),
  actual_amount       numeric null check (actual_amount is null or actual_amount >= 0),
  fallback_used       boolean not null default false,

  release_reason      text,

  -- Meter application. `meter_idempotency_key` is the unique idempotency key
  -- that makes replay into the meter at-most-once: a second attempt collides
  -- on this unique index instead of double-charging the agent.
  metered_at          timestamptz null,
  meter_idempotency_key text unique,

  -- Settlement hand-off into the channel state / settlement engine.
  settled_at          timestamptz null,
  settlement_ref      text,

  -- Set by the reconciler when it classifies a stuck row. null while healthy.
  orphan_class        text,

  correlation_id      text,

  reserved_at         timestamptz not null default now(),
  expires_at          timestamptz not null,
  committed_at        timestamptz null,
  released_at         timestamptz null,

  -- A terminal status must carry its terminal timestamp.
  constraint meter_usage_ledger_terminal_ts check (
    (status <> 'committed' or committed_at is not null)
    and (status <> 'released' or released_at is not null)
  ),

  -- A committed row is served usage: it must carry the priced amount.
  constraint meter_usage_ledger_commit_amount check (
    status <> 'committed' or actual_amount is not null
  ),

  -- A released row must explain itself, otherwise it is indistinguishable
  -- from a crash and cannot be classified by the reconciler.
  constraint meter_usage_ledger_release_reason check (
    status <> 'released' or release_reason is not null
  ),

  -- Committing twice, or committing after release, is never legitimate.
  constraint meter_usage_ledger_single_terminal check (
    not (committed_at is not null and released_at is not null)
  )
);

-- Drives the daily window scan (served/metered/settled aggregates).
create index if not exists idx_meter_usage_ledger_reserved_at
  on meter_usage_ledger (reserved_at);
create index if not exists idx_meter_usage_ledger_committed_at
  on meter_usage_ledger (committed_at)
  where committed_at is not null;
create index if not exists idx_meter_usage_ledger_metered_at
  on meter_usage_ledger (metered_at)
  where metered_at is not null;
create index if not exists idx_meter_usage_ledger_settled_at
  on meter_usage_ledger (settled_at)
  where settled_at is not null;

-- Orphan sweep: open reservations past their TTL.
create index if not exists idx_meter_usage_ledger_open_reservations
  on meter_usage_ledger (expires_at)
  where status = 'reserved';

-- Committed-but-unsettled sweep.
create index if not exists idx_meter_usage_ledger_unsettled
  on meter_usage_ledger (committed_at)
  where status = 'committed' and settled_at is null;

-- Committed-but-unmetered sweep.
create index if not exists idx_meter_usage_ledger_unmetered
  on meter_usage_ledger (committed_at)
  where status = 'committed' and metered_at is null;

alter table meter_usage_ledger enable row level security;

create policy "service role full access - meter usage ledger"
  on meter_usage_ledger for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- degraded_usage_log
-- ---------------------------------------------------------------------------
-- Usage that was served while the meter could not be written to (dependency
-- degraded, or the meter write itself failed). The reconciliation job replays
-- these into the meter once the store is healthy again.
create table if not exists degraded_usage_log (
  id                  uuid primary key default gen_random_uuid(),

  -- Idempotency key for replay. Unique: a given served call can be enqueued
  -- at most once, so a partially replayed log converges rather than
  -- double-billing.
  reservation_id      text not null unique,

  agent_id            text not null,
  route               text not null,
  unit_name           text not null,
  units               numeric not null check (units >= 0),
  amount              numeric not null check (amount >= 0),

  reason              text not null check (
                        reason in ('meter_unavailable', 'meter_write_failed', 'degraded_mode')
                      ),

  served_at           timestamptz not null,
  correlation_id      text,

  -- 'pending'   -> waiting for replay (or for the store to come back)
  -- 'replayed'  -> applied to the meter; `meter_applied_at` is set
  -- 'failed'    -> replay attempt errored; retried on later runs
  -- 'abandoned' -> gave up after `replay_attempts` reached the cap
  replay_state        text not null default 'pending'
                        check (replay_state in ('pending', 'replayed', 'failed', 'abandoned')),
  replay_attempts     integer not null default 0 check (replay_attempts >= 0),
  last_error          text,
  meter_applied_at    timestamptz,

  created_at          timestamptz not null default now(),

  -- A replayed row must record when it landed.
  constraint degraded_usage_log_replayed_ts check (
    replay_state <> 'replayed' or meter_applied_at is not null
  )
);

-- The drain query: pending entries oldest-first.
create index if not exists idx_degraded_usage_log_pending
  on degraded_usage_log (served_at)
  where replay_state = 'pending';
create index if not exists idx_degraded_usage_log_failed
  on degraded_usage_log (last_error)
  where replay_state = 'failed';
create index if not exists idx_degraded_usage_log_served_at
  on degraded_usage_log (served_at desc);

alter table degraded_usage_log enable row level security;

create policy "service role full access - degraded usage log"
  on degraded_usage_log for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- usage_reconciliation_reports
-- ---------------------------------------------------------------------------
-- One row per reconciliation run: the per-window served / metered / settled
-- figures and the three deltas between them.
create table if not exists usage_reconciliation_reports (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null unique,

  window_start        timestamptz not null,
  window_end          timestamptz not null,

  -- Served: usage delivered and priced in this window.
  served_count        integer not null default 0,
  served_amount       numeric not null default 0,
  -- Metered: usage that actually landed in the meter in this window.
  metered_count       integer not null default 0,
  metered_amount      numeric not null default 0,
  -- Settled: usage that reached channel state in this window.
  settled_count       integer not null default 0,
  settled_amount      numeric not null default 0,

  -- The three deltas. All three are zero in a healthy system.
  served_minus_metered  numeric not null default 0,
  metered_minus_settled numeric not null default 0,
  served_minus_settled  numeric not null default 0,

  -- Pre-repair view, so an auto-repaired gap is still visible in the audit trail.
  pre_repair_deltas   jsonb not null default '{}'::jsonb,

  -- Repair outcomes for this run.
  replay_attempted_count integer not null default 0,
  replayed_count         integer not null default 0,
  replayed_amount        numeric not null default 0,
  replay_failed_count    integer not null default 0,
  handed_off_count       integer not null default 0,
  handed_off_amount      numeric not null default 0,

  -- The full ReplayOutcome + SettlementHandoffOutcome objects for the run.
  -- The scalar columns above are the subset worth querying and alerting on;
  -- this keeps the rest (abandoned, already-applied, backpressured) so a report
  -- read back is the same report that was written, with no fields invented.
  repair_outcomes        jsonb not null default '{}'::jsonb,

  -- Orphan classification breakdown, keyed by orphan class.
  orphan_total_count  integer not null default 0,
  orphan_total_amount numeric not null default 0,
  orphan_breakdown    jsonb not null default '{}'::jsonb,

  -- Every discrepancy detected during the scan, whether or not auto-repaired.
  findings            jsonb not null default '[]'::jsonb,

  -- True when all three deltas are zero after repair.
  healthy             boolean not null default false,

  run_error           text,
  created_at          timestamptz not null default now(),

  -- The window must be a real interval.
  constraint usage_reconciliation_reports_window check (window_end >= window_start)
);

create index if not exists idx_usage_reconciliation_reports_created_at
  on usage_reconciliation_reports (created_at desc);
create index if not exists idx_usage_reconciliation_reports_unhealthy
  on usage_reconciliation_reports (created_at desc)
  where healthy = false;

alter table usage_reconciliation_reports enable row level security;

create policy "service role full access - usage reconciliation reports"
  on usage_reconciliation_reports for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');