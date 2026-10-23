# Backup, Retention, and Restore — RPO/RTO Definitions

Repo path: `docs/ops/backup-restore-rpo-rto.md`
Related: issue #1523, issue #1519 (Runbook 1 depends on the reconciliation
step described here)

## Honest scoping note

Everything below the signed-state store depends on two things this document
can't fully settle by itself:

1. **Supabase project settings.** True zero-RPO durability for anything living
   in Postgres comes from Supabase's own continuous WAL archiving / Point-in-
   Time Recovery (PITR), which is a project-tier setting, not application
   code. Confirm PITR is enabled on the production project and note the plan
   tier here once confirmed: `<SUPABASE_PLAN_AND_PITR_STATUS>`. The
   `channel_state_journal` trigger and the replication job in this PR are a
   second, off-provider safety net on top of PITR — not a replacement for it.
2. **The indexer doesn't fully exist yet.** `settlement-reconciliation-service.ts`
   already comments that it's using `pending_settlements.status = 'submitted'`
   as a proxy for the chain view "until a contract_events indexer enriches the
   record." The RPO/RTO for "the indexer" below is written against where that
   table is headed, not a fully-built system — revisit this doc once
   `contract_events` is real.

## Store-by-store

### 1. Signed-state store (`payment_channels.channel_state`)

**Criticality:** highest — per issue #1523, losing the newest signed state
means a counterparty's stale close cannot be disputed.

- **RPO target: effectively zero**, achieved via:
  - Supabase PITR / synchronous WAL (project-level, confirm status above).
  - `channel_state_journal` (migration `0001_signed_state_journal.sql`) —
    every write to `channel_state`, from any code path, is captured
    atomically in the same transaction via a Postgres trigger.
  - Off-provider replication (`signed-state-replication-job.ts`) — ships
    unreplicated journal rows every `<REPLICATION_INTERVAL, e.g. 5-15s>`.
    **Actual RPO = however stale the oldest unreplicated journal row is**,
    which `SignedStateReplicationJob.getReplicationLagMs()` reports — wire
    this into your alerting so a growing lag pages someone before it becomes
    an incident, not after.
- **RTO target:** `<DEFINE — e.g. 30 minutes to restore + verify>`. Measured
  by the `durationMs` field the restore drill script
  (`backend/scripts/restore-drill.ts`) reports each time it's run.
- **Retention:** journal rows are not pruned in the initial migration —
  decide a retention window here once you know how far back disputes or
  audits realistically need to look, then add a scheduled delete.

### 2. Meter store (`channel_payments`, `meter_reserves`)

**Criticality:** high, but recoverable — usage records can, in principle, be
reconciled against on-chain settlement history and the signed-state journal
if lost, which the signed-state store cannot.

- **RPO target:** `<DEFINE, e.g. 1 hour>` — covered by `store-backup-job.ts`
  scheduled export, not by the real-time journal.
- **RTO target:** `<DEFINE>`.
- **Retention:** `STORE_BACKUP_RETENTION_DAYS` env var, default 30 days in
  `store-backup-job.ts` — confirm this matches any regulatory/audit
  requirement before treating it as final.

### 3. Indexer-adjacent data (`pending_settlements`, future `contract_events`)

**Criticality:** medium — in principle re-derivable by re-indexing from
chain, but re-indexing has a real time cost, which is exactly what Runbook 6
in the incident runbooks doc is about.

- **RPO target:** `<DEFINE>` — same scheduled backup as the meter store,
  via `store-backup-job.ts`.
- **RTO target:** `<DEFINE — factor in actual chain re-index time once the
  indexer exists>`.
- **Retention:** same as meter store unless you decide otherwise.

## Restore drill procedure

1. Restore a **staging/scratch** Supabase project to a target point in time
   (via dashboard or CLI — provider-specific, not scripted here on purpose;
   see the safety check in `restore-drill.ts` that refuses to run against a
   URL matching production).
2. Apply the `channel_state_journal` migration if the scratch project
   predates it.
3. Point `RESTORE_DRILL_SUPABASE_URL` / `RESTORE_DRILL_SUPABASE_SERVICE_KEY`
   at the restored project.
4. Run `backend/scripts/restore-drill.ts`.
5. Record the result in `docs/runbooks/rehearsal-log.md` (see template in
   `docs/runbooks/incident-runbooks.md`): duration (RTO proxy), actual RPO
   (`rpoActualMs`), and whether every channel's restored sequence number
   matched the journal's newest entry for that channel.
6. A failed drill (`passed: false`) means the restore process itself lost
   data that the journal proves should have existed — treat this as a bug in
   the restore/replication path, not just a note for next time.

## Open decisions before this can be marked "done"

- [ ] Confirm Supabase PITR status and record it above.
- [ ] Pick concrete RPO/RTO numbers for each store (marked `<DEFINE>` above)
      and get sign-off from whoever owns the counterparty-facing risk.
- [ ] Decide `channel_state_journal` retention window.
- [ ] Replace `LocalFileReplicationSink` with a real off-provider client
      (S3/GCS/R2) before relying on this for production.
- [ ] Run the restore drill in staging at least once for Runbooks 1-3 per
      issue #1519's done-when criterion, and log it.