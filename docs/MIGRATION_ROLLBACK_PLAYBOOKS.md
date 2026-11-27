# Migration Rollback Playbooks

## Overview

This document covers rollback strategies for all high-risk migrations in SYNCRO. Each migration group has a dedicated rollback SQL file in `docs/rollbacks/` and is covered by pre-rollback verification queries.

**Before any rollback:**
1. Run the verification script to confirm it is safe to proceed.
2. Take a database snapshot (Supabase dashboard → Database → Backups).
3. Notify the team in the incident channel.
4. Execute the rollback SQL inside a transaction — review the output before committing.

---

## Quick Reference

| Migration Group | Rollback File | Risk | Key Concern |
|---|---|---|---|
| Renewal tables | `rollback_renewal_tables.sql` | HIGH | Drops billing/renewal audit history |
| Reminder tables | `rollback_reminder_tables.sql` | HIGH | Drops active reminder schedules |
| Expiry columns | `rollback_expiry_columns.sql` | HIGH | `expiry_threshold` data unrecoverable |
| Renewal cooldown | `rollback_renewal_cooldown.sql` | MEDIUM-HIGH | Removes retry storm guard |
| 2FA tables | `rollback_2fa_tables.sql` | HIGH | Breaks 2FA for all users |
| Monthly digest | `rollback_monthly_digest.sql` | MEDIUM | Drops digest history |
| Budget & Slack | `rollback_budget_and_slack.sql` | MEDIUM | Drops budget alert history |
| Gift card ledger | `rollback_gift_card_ledger.sql` | HIGH | Drops financial ledger |
| API key auth fields | `rollback_api_key_auth_fields.sql` | HIGH | Breaks all API key auth immediately |

---

## Step-by-Step Rollback Procedure

### 1. Verify safety

```bash
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
  node scripts/verify-rollback-safety.js

# Or for a single group:
node scripts/verify-rollback-safety.js --group renewal_tables
```

Exit code `0` = safe. Exit code `1` = unsafe, do not proceed.

### 2. Take a backup

In the Supabase dashboard: **Database → Backups → Create backup**.

Or via CLI:
```bash
supabase db dump --db-url "$DATABASE_URL" > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 3. Execute the rollback

Connect to the database and run the relevant file inside a transaction. The files already wrap changes in `BEGIN` / `COMMIT`. Review the verification queries at the top of each file before committing.

```bash
psql "$DATABASE_URL" -f docs/rollbacks/rollback_<group>.sql
```

Or paste into the Supabase SQL editor — the `BEGIN`/`COMMIT` wrapper lets you inspect results before committing.

### 4. Run post-rollback verification

Each rollback file contains commented `POST-ROLLBACK VERIFICATION` queries. Run them to confirm the schema is in the expected state.

### 5. Restart affected services

```bash
# Backend
cd backend && npm run build && npm start

# Trigger a health check
curl -f https://<backend-url>/health
```

### 6. Update the incident log

Record: timestamp, operator, rollback applied, verification result, and any data loss.

---

## Migration-Specific Notes

### Renewal Tables (`rollback_renewal_tables.sql`)

Covers `renewal_logs`, `renewal_approvals`, `renewal_locks`.

- `renewal_locks` uses a partial unique index to enforce one active lock per `(subscription_id, cycle_id)`. Rolling back while locks are active will leave the renewal executor in an inconsistent state.
- `renewal_logs` is append-only audit history — data loss is permanent.
- **Safe-to-rollback state**: `renewal_locks` has no `status = 'active'` rows; `renewal_approvals` has no `used = false AND expires_at > NOW()` rows.

### Reminder Tables (`rollback_reminder_tables.sql`)

Covers `reminder_schedules`, `notification_deliveries`, `delayed_notifications`, `reminder_settings`.

- Rolling back while `status = 'pending'` reminders exist means those reminders will never fire.
- `notification_deliveries` with `status = 'retrying'` will be silently abandoned.
- The cron jobs in `backend/src/jobs/reminder-job.ts` will error on next run until the tables are re-created.

### Expiry Columns (`rollback_expiry_columns.sql`)

Covers `add_expiry_columns` (adds `expiry_threshold`, `expired_at`, updates CHECK constraint) and `rework_expiry` (drops `expiry_threshold`, adds v2 index).

- `rework_expiry` **dropped** `expiry_threshold` — the rollback restores the column but the original data is gone.
- The rollback also removes `'expired'` from the `status` CHECK constraint. Any rows currently with `status = 'expired'` must be updated first or the constraint addition will fail.
- Run: `UPDATE public.subscriptions SET status = 'cancelled' WHERE status = 'expired';` before rolling back if needed.

### Renewal Cooldown (`rollback_renewal_cooldown.sql`)

- Removing the cooldown guard means the renewal executor can immediately retry without delay. Under incident conditions this can cause a retry storm.
- Disable the renewal cron job before rolling back: comment out or stop `reminder-job.ts`.

### 2FA Tables (`rollback_2fa_tables.sql`)

- **CRITICAL**: If any team has `require_2fa = true`, rolling back will lock those users out of the application. The rollback script sets `require_2fa = false` on all teams as a safety step, but this must be communicated to team admins.
- `recovery_codes` are bcrypt-hashed one-time codes. Dropping the table is irreversible — users will need to re-enrol 2FA after the migration is re-applied.

### Monthly Digest (`rollback_monthly_digest.sql`)

- Users with `digest_enabled = true` will stop receiving digests. No user-facing error — the digest job will simply find no opted-in users.
- `digest_audit_log` history is permanently lost.

### Budget & Slack (`rollback_budget_and_slack.sql`)

- `budget_alert_logs` deduplication relies on a `UNIQUE(user_id, alert_type, month)` constraint. Rolling back and re-applying will cause duplicate alerts to fire for the current month.
- Teams lose their Slack webhook URL — re-configuration required.

### Gift Card Ledger (`rollback_gift_card_ledger.sql`)

- The `gift_card_balance` view is a derived aggregate — it can be reconstructed from ledger rows. However, once the table is dropped, all balance history is permanently lost.
- Confirm no deductions are in-flight (check the last 24h) before rolling back.

### API Key Auth Fields (`rollback_api_key_auth_fields.sql`)

- **CRITICAL**: Dropping `key_hash` immediately breaks all API key authentication. Every integration using `x-api-key` will receive `401 Invalid API key`.
- Notify all API consumers before executing this rollback.
- After rollback, the `authenticate` middleware in `backend/src/middleware/auth.ts` will fail to find any key records and reject all API key requests.

---

## Retention & Visibility

- Rollback SQL files are version-controlled in `docs/rollbacks/` and reviewed as part of the migration PR.
- The verification script (`scripts/verify-rollback-safety.js`) is the authoritative pre-flight check — do not skip it.
- All rollback executions must be logged in the incident record with: operator, timestamp, migration group, verification output, and data loss assessment.

---

## Related Documentation

- [RLS Audit Guide](./RLS_AUDIT_GUIDE.md)
- [Migration Drift Check](../scripts/MIGRATION_DRIFT_CHECK.md)
- [Audit Trail](./AUDIT_TRAIL.md)
