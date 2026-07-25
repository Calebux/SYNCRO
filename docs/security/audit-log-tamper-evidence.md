# Tamper-Evident Audit Log

Issue: [#1081](https://github.com/Calebux/SYNCRO/issues/1081)

`audit_logs` is append-only and hash-chained. An administrator with database
access can still *reach* the table, but they cannot edit or remove an entry
without leaving evidence that the verification endpoint will find.

## How it works

Every row carries three chain columns:

| Column | Meaning |
| --- | --- |
| `sequence` | Monotonic position in the chain, assigned by the application. A gap means an entry was deleted. |
| `entry_hash` | SHA-256 over the canonical form of the row's contents. |
| `prev_hash` | The `entry_hash` of the entry before it; `NULL` for the genesis entry. |

Because each entry's hash covers the previous entry's hash, the chain is
self-reinforcing:

- **Edit a row in place** → its contents no longer hash to the stored
  `entry_hash` → `hash_mismatch`.
- **Edit it and recompute its `entry_hash`** → every later row still holds the
  *old* hash in `prev_hash` → `broken_link` at the next entry.
- **Delete a row** → its sequence number is missing and the following row links
  to a hash that is no longer present → `missing_entry` + `broken_link`.
- **Reorder rows** → the links no longer resolve → `broken_link`.

Rewriting the whole chain from the tampered point onward is the only way to
produce a self-consistent forgery, and that requires rewriting every subsequent
entry — which changes the tip hash. Record the tip hash externally (see
[Monitoring](#monitoring)) to close that gap.

## Enforcement

Two mechanisms, doing different jobs:

1. **A database trigger** (`audit_logs_append_only`) rejects every `UPDATE` and
   `DELETE`. Triggers fire for all roles including `service_role`, so this holds
   even against the backend's own credentials — unlike RLS, which the service
   role bypasses. The previous `audit_logs_delete_admin` RLS policy, which let
   any admin JWT delete rows, has been dropped.
2. **The hash chain** detects tampering that bypasses the trigger entirely —
   direct superuser access, a restored-from-backup table, or an operator who
   disabled the trigger.

The trigger is prevention; the chain is detection. Neither alone is sufficient.

## Verification endpoint

```
GET /api/audit/verify?startSequence=&endSequence=&limit=
```

Admin-only. Always responds `200` with the result — **alert on `valid: false`**.

```json
{
  "success": true,
  "valid": false,
  "entriesChecked": 1284,
  "firstSequence": 1,
  "lastSequence": 1284,
  "legacyEntries": 0,
  "issues": [
    {
      "type": "hash_mismatch",
      "sequence": 412,
      "entryId": "…",
      "expected": "9f2c…",
      "actual": "1a7b…",
      "message": "Entry 412 has been modified since it was written"
    }
  ]
}
```

| Query param | Default | Meaning |
| --- | --- | --- |
| `startSequence` | chain start | First sequence number to check. |
| `endSequence` | chain end | Last sequence number to check. |
| `limit` | 1000 (max 10000) | Maximum entries to walk. |

Verifying a partial range still checks the first link: the entry immediately
before the range is fetched to anchor it.

### Issue types

| Type | Meaning |
| --- | --- |
| `hash_mismatch` | The row's contents were changed after it was written. |
| `broken_link` | The row's `prev_hash` does not match the preceding entry — something was re-signed, reordered or removed. |
| `missing_entry` | A gap in `sequence` — an entry was deleted. |
| `unchained` | The row predates the hash chain (see below). Reported, but not a failure. |

## Concurrency

Chain writes are serialized in-process by a promise lock, so two requests cannot
read the same tip and claim the same sequence number. Across processes, the
unique index on `sequence` makes the loser's insert fail with `23505` and the
service retries against the new tip (3 attempts).

Under heavy multi-instance write load this read-tip-then-insert pattern is a
throughput ceiling. If audit write volume becomes a bottleneck, move sequence
assignment into a Postgres function so the tip read and the insert happen in one
statement.

## Legacy entries

Rows written before this was deployed have `NULL` chain columns. They are
reported as `unchained` and do not fail verification — they cannot be
retro-signed without inventing evidence that never existed. The chain begins at
the first entry written after the migration.

## Retention

The append-only trigger blocks the usual retention job. Pruning old entries
requires an operator to explicitly run:

```sql
ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_no_delete;
-- prune, then:
ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_no_delete;
```

This is deliberate friction: the DDL is itself logged by the database, and the
resulting sequence gaps will show up as `missing_entry` on the next
verification. Prune from the *head* of the chain and record the new
`startSequence` so routine verification does not report the pruned range.

## Monitoring

Run verification on a schedule and alert on `valid: false`. To also detect a
wholesale chain rewrite, store the tip `entry_hash` somewhere outside the
database (a secrets manager, an append-only log service, or a monitoring
system's state) after each check, and compare on the next run.

## Where the code lives

| File | Role |
| --- | --- |
| `backend/src/services/audit-chain.ts` | Canonical hashing and the verification walk (pure functions). |
| `backend/src/services/audit-service.ts` | Chained inserts, tip reads, `verifyChain`. |
| `backend/src/routes/audit.ts` | `GET /api/audit/verify`. |
| `supabase/migrations/20260725000000_audit_log_hash_chain.sql` | Chain columns, unique index, append-only trigger. |
| `backend/tests/audit-hash-chain.test.ts` | Tamper-detection tests. |

### Canonical form

Hashes are computed over a JSON array of
`[sequence, user_id, action, resource_type, resource_id, metadata, ip_address,
user_agent, created_at, prev_hash]`, with:

- object keys **sorted recursively**, so a JSONB round-trip (which does not
  preserve key order) hashes identically;
- timestamps reduced to **epoch milliseconds**, so Postgres' `timestamptz`
  formatting does not affect the hash;
- UUIDs **lowercased**.

Changing the canonical form breaks verification for every existing entry. If it
ever must change, version it and verify old entries with the old form.
