# Contract Storage TTL and Archival Strategy

**Issue:** [#1068 - Hardening: contract storage TTL / archival (state rent) strategy](https://github.com/Calebux/SYNCRO/issues/1068)

**Author:** SYNCRO Core Team  
**Date:** August 2026  
**Status:** Active

---

## Table of Contents

1. [Overview](#overview)
2. [Terminology](#terminology)
3. [TTL Semantics](#ttl-semantics)
4. [Archival Policy](#archival-policy)
5. [Configuration](#configuration)
6. [Active Entry Definition](#active-entry-definition)
7. [TTL Bump Strategy](#ttl-bump-strategy)
8. [Archival Lifecycle](#archival-lifecycle)
9. [Snapshot and Proof Management](#snapshot-and-proof-management)
10. [Rate Limiting and Safety](#rate-limiting-and-safety)
11. [Audit and Compliance](#audit-and-compliance)
12. [Operator Responsibilities](#operator-responsibilities)
13. [Troubleshooting](#troubleshooting)
14. [Security Considerations](#security-considerations)

---

## Overview

The SYNCRO platform manages long-lived contract entries (subscriptions, vouchers, approvals, logs) on the Stellar Soroban blockchain. Like other blockchains, Soroban implements **state rent** to incentivize cleanup of obsolete entries. This document defines SYNCRO's strategy for managing contract storage lifecycle:

- **TTL Management**: Automatically extend the Time-To-Live (TTL) of active contract entries before expiration.
- **Archival**: Create privacy-preserving off-chain snapshots of expired entries and record proof on-chain via immutable markers.
- **Deletion**: Safely delete archived entries only after retention windows and explicit admin confirmation.

This strategy balances:
- **Cost Efficiency**: Minimizes state rent by removing stale entries.
- **Auditability**: Maintains tamper-evident records of all entry lifecycle events.
- **Privacy**: Redacts sensitive data in snapshots per security policy.
- **Disaster Recovery**: Enables restoration of archived entries if needed.
- **Safety**: Prevents accidental data loss and ensures idempotent, resumable operations.

---

## Terminology

| Term | Definition |
|------|-----------|
| **TTL** | Time-To-Live; the absolute ledger sequence at which a contract entry expires on-chain. Set by Soroban consensus; if not extended, the entry is evicted and state rent is charged. |
| **Entry** | A single contract storage location identified by a unique `entry_key` (e.g., subscription record, voucher, approval state). |
| **Active Entry** | An entry that is currently in use (recent authenticated read or write by owner or authorized worker) and should have its TTL extended. |
| **TTL Bump** | The act of calling `extend_ttl(entry_key, new_ttl)` to extend an entry's expiration date. |
| **TTL Extension** | The duration added to the current TTL. Default: `DEFAULT_TTL_EXTENSION` (e.g., 90 days). |
| **Bump Window** | The time period before expiration during which a TTL bump is eligible. Default: `BUMP_THRESHOLD` (e.g., 7 days remaining). |
| **Bump Interval** | Minimum elapsed time between successive bumps for the same entry. Default: `MIN_BUMP_INTERVAL` (e.g., 24 hours). Prevents rate-limit abuse. |
| **Archival** | The process of creating an off-chain snapshot of an expired entry, computing its hash, and marking it on-chain with a tombstone. |
| **Archival Grace Period** | The duration after TTL expiration before an entry is archived. Default: `ARCHIVAL_GRACE_PERIOD` (e.g., 14 days). Provides a safety margin for recovery attempts. |
| **Snapshot** | A JSON or compressed blob containing the archived entry's state, redacted for privacy. Stored off-chain in S3, IPFS, or local archive. |
| **Snapshot Hash** | Cryptographic SHA-256 hash of the snapshot blob, stored on-chain as proof of archival. Enables integrity verification. |
| **Snapshot Proof** | The transaction evidence (tx_hash, sequence, timestamp) linking the on-chain `mark_archived` call to the off-chain snapshot. |
| **Retention Window** | The duration after archival during which the off-chain snapshot is retained. Default: `ARCHIVAL_RETENTION_WINDOW` (e.g., 1 year). After expiry, snapshot may be purged. |
| **Tombstone** | An on-chain marker indicating that an entry has been archived. Prevents re-activation of deleted entries. |
| **Worker** | A background service (cron job or serverless function) that scans and manages TTL bumps and archival. Runs on a schedule (e.g., daily). |
| **State Rent** | Fees charged by Soroban consensus for storage of contract entries. Minimized by timely archival and cleanup. |

---

## TTL Semantics

### Ledger Sequence and Expiration

In Stellar Soroban:
- Every entry has a `TTL` field specifying the ledger sequence at which it expires.
- If `current_ledger_sequence >= entry.TTL`, the entry is **evicted** during ledger confirmation.
- Evicted entries incur **state rent** charges proportional to the time the entry was stored.
- State rent is deducted from the contract's reserve balance. If insufficient, renewal transactions fail.

### TTL Extension Mechanics

The `extend_ttl(entry_key: Bytes, new_ttl: u64)` contract method:
- **Precondition**: `new_ttl > current_entry_ttl` (only increases, never decreases or resets).
- **Idempotency**: Calling with the same `new_ttl` multiple times is safe (idempotent).
- **Authorization**: Requires caller signature (owner) or authorized worker role.
- **Atomicity**: All-or-nothing; if the call fails, the entry's TTL is unchanged.
- **Event**: Emits an `ExtendedTTL` event with `entry_key`, `new_ttl`, and actor identity (for audit).

### Worker Responsibilities

The TTL Bump Worker:
- **Scans** contract entries for those with `remaining_ttl < BUMP_THRESHOLD`.
- **Validates** that the entry is active (recent access or subscribed worker).
- **Batches** TTL extensions to minimize gas and transaction overhead.
- **Retries** failed calls with exponential backoff.
- **Audits** all mutations with tamper-evident logs.
- **Respects** rate limits per entry and global batch limits.

---

## Archival Policy

### Archival Trigger

An entry is eligible for archival when:

1. **TTL Expired**: `current_ledger_sequence >= entry.TTL` (entry is evicted).
2. **Grace Period Elapsed**: `current_time >= entry.ttl_expire_time + ARCHIVAL_GRACE_PERIOD` (safety buffer for recovery).
3. **No Recent Activity**: No successful TTL bump or owner access within `ARCHIVAL_GRACE_PERIOD`.

### Archival Workflow

```
Expired Entry
    ↓
[ARCHIVAL_GRACE_PERIOD elapsed?]
    ↓ YES
Create Snapshot (JSON)
    ↓
Redact Sensitive Fields
    ↓
Compute Snapshot Hash (SHA-256)
    ↓
Store Off-Chain (S3/IPFS)
    ↓
Call mark_archived(entry_key, snapshot_hash) on-chain
    ↓ [Success]
Record Archival Metadata (tx_hash, snapshot_path, timestamp)
    ↓
Mark Entry as "Archived" in Archival Index
    ↓ [Failed]
Log Error & Alert; Retry Next Run
```

### Archival Actions

The `mark_archived(entry_key: Bytes, snapshot_hash: Bytes)` contract method:
- **Sets** the entry's archived flag to `true`.
- **Stores** the snapshot hash on-chain for integrity verification.
- **Emits** an `ArchivedEntry` event with `entry_key`, `snapshot_hash`, and timestamp.
- **Prevents** future TTL extensions on archived entries (archived entries cannot be reactivated without explicit admin action).

### Deletion Policy

**Deletion is a manual, audited operation.** Automated deletion is NOT performed.

- **Criteria**: Entry is archived AND `current_time >= archival_timestamp + ARCHIVAL_RETENTION_WINDOW`.
- **Process**:
  1. Admin reviews archival metadata and audit logs.
  2. Admin calls `delete_archived(entry_key)` with signed authorization.
  3. Worker validates authorization and deletes from archival index and storage.
  4. On-chain tombstone remains as permanent proof of deletion.

---

## Configuration

All configuration parameters are defined in `config/ttl.json` and validated at startup. Override with environment variables using `TTL_*` prefix.

### TTL Configuration Schema

```json
{
  "ttl": {
    "bumpThreshold": 7,
    "bumpThresholdUnit": "days",
    "defaultTtlExtension": 90,
    "defaultTtlExtensionUnit": "days",
    "minBumpInterval": 24,
    "minBumpIntervalUnit": "hours",
    "archivalGracePeriod": 14,
    "archivalGracePeriodUnit": "days",
    "archivalRetentionWindow": 365,
    "archivalRetentionWindowUnit": "days",
    "batchSize": 50,
    "maxGasPerBatch": 10000000,
    "workerSchedule": "0 0 * * *",
    "archivalSchedule": "0 2 * * *",
    "snapshotStorage": "s3",
    "snapshotBucket": "syncro-archival-snapshots",
    "snapshotEncryption": true,
    "redactSensitiveFields": true,
    "auditLevel": "full",
    "retryMaxAttempts": 5,
    "retryBackoffMs": 1000,
    "rateLimitPerEntry": {
      "bumpsPerDay": 2,
      "archivals": 1
    }
  }
}
```

### Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `bumpThreshold` | number | 7 | Remaining days before expiration to trigger bump eligibility. |
| `defaultTtlExtension` | number | 90 | Days to add to TTL when bumping. |
| `minBumpInterval` | number | 24 | Minimum hours between bumps for same entry; prevents rate-limit abuse. |
| `archivalGracePeriod` | number | 14 | Days after expiration to wait before archival; safety buffer. |
| `archivalRetentionWindow` | number | 365 | Days to retain off-chain snapshots after archival. |
| `batchSize` | number | 50 | Max entries to process per worker run. |
| `maxGasPerBatch` | number | 10000000 | Max cumulative gas per batch; stops processing if exceeded. |
| `workerSchedule` | cron string | `0 0 * * *` | Cron schedule for TTL bump worker (daily midnight UTC). |
| `archivalSchedule` | cron string | `0 2 * * *` | Cron schedule for archival worker (daily 2 AM UTC). |
| `snapshotStorage` | enum | `s3` | Snapshot backend: `s3`, `ipfs`, `local`. |
| `snapshotBucket` | string | `syncro-archival-snapshots` | S3 bucket or IPFS namespace for snapshots. |
| `snapshotEncryption` | boolean | `true` | Encrypt snapshots at rest with AES-256-GCM. |
| `redactSensitiveFields` | boolean | `true` | Redact PII and sensitive payment fields in snapshots. |
| `auditLevel` | enum | `full` | Audit detail: `minimal`, `standard`, `full`. |
| `retryMaxAttempts` | number | 5 | Max retries for transient failures. |
| `retryBackoffMs` | number | 1000 | Initial backoff (ms) for exponential retry. |
| `rateLimitPerEntry.bumpsPerDay` | number | 2 | Max TTL bumps per entry per day. |
| `rateLimitPerEntry.archivals` | number | 1 | Max archival attempts per entry. |

### Environment Variable Overrides

```bash
export TTL_BUMP_THRESHOLD_DAYS=7
export TTL_DEFAULT_EXTENSION_DAYS=90
export TTL_WORKER_SCHEDULE="0 0 * * *"
export TTL_SNAPSHOT_STORAGE="s3"
export TTL_SNAPSHOT_BUCKET="syncro-archival-prod"
export TTL_ARCHIVAL_GRACE_PERIOD_DAYS=14
```

---

## Active Entry Definition

An entry is considered **active** if:

1. **Owner Authenticated Access**: Recent authenticated read/write by the subscription owner within `BUMP_THRESHOLD` days.
   - Indicators: subscription renewal call, approval modification, payment attempt.

2. **Worker Subscription**: The entry is tracked in an active subscription context (e.g., recurring renewal job, active voucher code).
   - Indicators: subscription status is `active`, renewal is scheduled, worker has pending operations.

3. **Recent Audit Event**: An audit event (non-expiration) referencing the entry within `BUMP_THRESHOLD` days.
   - Indicators: approval signed, renewal processed, payment confirmed.

An entry is considered **inactive** if:
- No owner access for >= `BUMP_THRESHOLD` days.
- Subscription status is `cancelled` or `expired`.
- No pending worker operations.

**Note**: A subscription renewal in the past hour makes the entry active; a renewal attempt two weeks ago does not.

---

## TTL Bump Strategy

### Eligibility Criteria

A TTL bump is issued if ALL of:

1. **Remaining TTL < BUMP_THRESHOLD**: `entry.ttl - current_sequence < threshold_sequence_count`.
2. **Entry is Active**: Per the Active Entry Definition (above).
3. **Rate Limit Not Exceeded**: `last_bump_timestamp + MIN_BUMP_INTERVAL <= now`.
4. **No Archived Flag**: Entry has not been marked as archived.

### Bump Calculation

```typescript
new_ttl = current_sequence + (DEFAULT_TTL_EXTENSION_DAYS * sequences_per_day)
```

Example: If `current_sequence = 12,345,678` and `DEFAULT_TTL_EXTENSION = 90 days` (2,160 sequences/day on Soroban testnet):
```
new_ttl = 12,345,678 + (90 * 2,160) = 12,539,278
```

**Idempotency**: Calling `extend_ttl` twice with the same `new_ttl` is safe; the second call succeeds with no state change.

### Bump Batching

- Worker collects up to `BATCH_SIZE` entries eligible for bumping.
- Groups entries into transactions to minimize gas overhead.
- Respects `MAX_GAS_PER_BATCH`; if adding next entry exceeds limit, submits current batch and starts new one.
- Each transaction is submitted independently; if one fails, others in the batch still succeed (partial-batch resilience).

### Retry Logic

On transient failure (network timeout, temporary contract error):
- Retry with exponential backoff: `delay = retryBackoffMs * (2 ^ attempt)` (e.g., 1s, 2s, 4s, 8s, 16s).
- Max `retryMaxAttempts` (default: 5).
- If all retries fail, log critical error and alert operators.

On permanent failure (invalid signature, insufficient funds):
- Log error with entry_key and error details.
- Alert operators via Sentry and monitoring dashboard.
- Do NOT retry; manual investigation required.

---

## Archival Lifecycle

### Phase 1: Detection (Daily Archival Worker)

```typescript
for (expiredEntry of getExpiredEntries()) {
  if (now >= entry.expiry_timestamp + ARCHIVAL_GRACE_PERIOD) {
    if (!entry.archived_flag && hasNoRecentActivity(entry)) {
      queue(entry, 'READY_FOR_ARCHIVAL');
    }
  }
}
```

### Phase 2: Snapshot Creation

```typescript
snapshot = {
  entryKey: entry.key,
  entryType: entry.type,
  state: redact(entry.state, REDACTION_POLICY),
  expiryTimestamp: entry.expiry_timestamp,
  archivalTimestamp: now(),
  operatorId: WORKER_ID,
};
snapshotBlob = JSON.stringify(snapshot);
snapshotHash = sha256(snapshotBlob);
```

### Phase 3: Off-Chain Storage

```typescript
snapshotPath = `archival/${entry.key.slice(0, 16)}/${entry.key}/${snapshotHash}.json`;
if (TTL_CONFIG.snapshotEncryption) {
  encryptedBlob = aes256gcm.encrypt(snapshotBlob, ENCRYPTION_KEY);
  store(snapshotPath, encryptedBlob);
} else {
  store(snapshotPath, snapshotBlob);
}
```

### Phase 4: On-Chain Marking

```typescript
txResult = await blockchainService.markArchived(
  entryKey,
  snapshotHash,
  WORKER_KEY,
);
if (txResult.success) {
  archivalIndex.insert({
    entryKey,
    snapshotPath,
    snapshotHash,
    txHash: txResult.tx_hash,
    txSequence: txResult.sequence,
    archivalTimestamp: now(),
  });
} else {
  throw new ArchivalMarkError(`Failed to mark archived: ${txResult.error}`);
}
```

### Phase 5: Metadata Persistence

Archival metadata is stored in `archival_index` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Unique archival record identifier. |
| `entry_key` | BYTEA | Contract entry key. |
| `entry_type` | VARCHAR | Type of entry (subscription, voucher, approval). |
| `snapshot_path` | VARCHAR | Off-chain storage path. |
| `snapshot_hash` | BYTEA | SHA-256 hash of snapshot. |
| `tx_hash` | BYTEA | Transaction hash of mark_archived call. |
| `tx_sequence` | BIGINT | Ledger sequence of archival transaction. |
| `archival_timestamp` | TIMESTAMPTZ | When archival was performed. |
| `expiry_timestamp` | TIMESTAMPTZ | Original on-chain TTL expiration time. |
| `operator_id` | VARCHAR | Worker ID or admin identifier. |
| `status` | VARCHAR | `archived`, `retained`, `purged`. |
| `retention_expires_at` | TIMESTAMPTZ | When retention window ends; after this, snapshot eligible for purge. |

---

## Snapshot and Proof Management

### Snapshot Structure

```json
{
  "archivalMetadata": {
    "entryKey": "0x...",
    "entryType": "subscription",
    "archivalVersion": "1.0",
    "archivalTimestamp": "2026-08-25T14:30:00Z",
    "expiryTimestamp": "2026-08-25T12:00:00Z",
    "operatorId": "ttl-bump-worker-001",
    "snapshotHash": "0x..."
  },
  "entryState": {
    "subscriptionId": "sub_123456",
    "ownerId": "owner_abcdef",
    "status": "expired",
    "lastRenewalTimestamp": "2026-08-20T10:00:00Z",
    "approvalState": "REDACTED_FOR_PRIVACY",
    "paymentDetails": "REDACTED_FOR_PRIVACY"
  },
  "auditTrail": [
    {
      "timestamp": "2026-08-20T10:00:00Z",
      "action": "renewal_attempted",
      "actor": "subscription_owner",
      "result": "success"
    },
    {
      "timestamp": "2026-08-25T10:00:00Z",
      "action": "ttl_bump_attempted",
      "result": "failed_grace_period_expired"
    }
  ]
}
```

### Snapshot Hash Verification

```typescript
storedSnapshot = loadSnapshot(snapshotPath);
computedHash = sha256(JSON.stringify(storedSnapshot));
if (computedHash !== archivalIndex.snapshot_hash) {
  throw new IntegrityError('Snapshot hash mismatch; snapshot may be corrupted');
}
```

### Proof of Archival

On-chain proof is immutable:
- `ExtendedTTL` events for TTL bumps.
- `ArchivedEntry` events for archival marks.
- Both events include timestamp, actor, and state proof.

Off-chain proof is the archival metadata record in `archival_index`:
- Links `entry_key` → `snapshot_hash` → `snapshot_path` → `tx_hash`.
- Enables recovery: given entry_key, retrieve snapshot_hash; given snapshot_hash, retrieve and verify snapshot.

---

## Rate Limiting and Safety

### Rate Limits

**Per-Entry Limits:**
- Max `rateLimitPerEntry.bumpsPerDay` (default: 2) TTL bumps per calendar day per entry.
- Max `rateLimitPerEntry.archivals` (default: 1) archival attempt per entry over its lifetime.

**Implementation:**
```typescript
lastBumpTimestamps = cache.get(`ttl_bumps:${entryKey}`);
if (lastBumpTimestamps.filter(t => now - t < 1_day).length >= BUMPS_PER_DAY) {
  skip(entry, 'RATE_LIMIT_EXCEEDED');
}
```

**Batch Limits:**
- Max `batchSize` (default: 50) entries per worker run.
- Max `maxGasPerBatch` (default: 10M gas) cumulative gas per run; stops processing if exceeded.

### Gas Budgeting

```typescript
let cumulativeGas = 0;
for (entry of eligibleEntries) {
  estimatedGas = simulateExtendTTL(entry);
  if (cumulativeGas + estimatedGas > MAX_GAS_PER_BATCH) {
    log.info(`Batch limit reached; ${remainingEntries.length} entries deferred`);
    break;
  }
  cumulativeGas += estimatedGas;
  processBatch.push(entry);
}
```

### Idempotency

Worker is **fully idempotent**:
- Calling worker twice in same hour on same entry: no duplicate bumps (rate limit prevents it).
- On-chain `extend_ttl` is idempotent: same `new_ttl` succeeds silently.
- Snapshot creation: if snapshot already exists, hash matches; no duplicate storage or on-chain call.
- Archival: marking twice with same snapshot_hash is safe (on-chain flag already set).

**Deduplication Key**: `<entry_key>:<action>:<new_ttl>` with 24-hour uniqueness window.

### Failure Resilience

- **Partial Batch Failure**: If entry N fails, entries N+1..M still processed and succeed.
- **Worker Crash**: On restart, worker scans from beginning; idempotency ensures no double-charges.
- **Snapshot Storage Failure**: If S3 upload fails, do NOT call `mark_archived` on-chain; retry next run.
- **On-Chain Call Failure**: Log and retry with backoff; after max retries, alert operators; do not proceed to archival.

---

## Audit and Compliance

### Audit Event Types

Every TTL and archival mutation generates an audit event with the schema:

```typescript
interface TTLAuditEvent {
  timestamp: ISO8601;
  correlationId: UUID; // Links related events
  entryKey: Bytes; // Full or hashed per redaction policy
  entryType: string; // 'subscription', 'voucher', 'approval'
  action: 'extend_ttl' | 'mark_archived' | 'delete_archived' | 'archival_snapshot_created';
  actor: string; // Worker ID, admin user, or service account
  status: 'success' | 'failed' | 'partial';
  resultDetails: object; // Action-specific details
  txHash?: Bytes; // On-chain transaction hash if applicable
  snapshotHash?: Bytes; // For archival events
  errorMessage?: string; // If status is failed
  gasCost?: number; // Actual gas consumed
  durationMs?: number; // Execution time
}
```

### Privacy-Safe Logging

Audit logs MUST NOT contain:
- Full subscription or payment details.
- PII (user names, email addresses, phone numbers).
- Decrypted or raw sensitive fields.

Audit logs MAY contain:
- Hashed entry_key (or first 16 hex chars).
- Entry type (subscription, voucher, approval).
- Timestamp and actor identity.
- Action outcome (success/failure) and error class.
- Gas cost and gas efficiency metrics.

### Retention and Access

- **Retention**: Audit events retained for >= 7 years per financial compliance requirements.
- **Access**: Read-only via authenticated admin endpoints; admin must be in `audit_admin` role.
- **Query**: Support filtering by entry_key, action, date range, status.

### Chain Verification

Audit events are stored in a tamper-evident hash chain (per `AuditService`):
- Each event includes `prevHash` (hash of previous event) and `entryHash` (hash of current event).
- Chain integrity verified by walking the chain and recomputing hashes.
- Tampering detected if computed hash != stored hash.

---

## Operator Responsibilities

### Daily Operations

1. **Monitor Worker Runs**:
   - Check logs for errors in `/var/log/ttl-bump-worker.log` and `/var/log/archival-worker.log`.
   - Alert if worker fails 3+ times in a row; indicates misconfiguration or contract issue.

2. **Review Metrics**:
   - Track bump success rate (target: >= 99%).
   - Track archival success rate (target: >= 98%).
   - Track gas cost per bump (target: <= 500K gas per entry).
   - Alert if success rate drops or costs spike.

3. **Audit Log Review**:
   - Query recent TTL and archival events daily (5-minute query).
   - Verify no unauthorized marks or deletions.
   - Escalate any suspicious activity to security team.

### Weekly Operations

1. **Capacity Planning**:
   - Count active vs. archived entries.
   - Project storage costs (on-chain state rent, off-chain snapshots).
   - If archival volume spikes, investigate root cause (e.g., mass subscription cancellations).

2. **Backup Verification**:
   - Spot-check archived snapshots; verify integrity (recompute hashes).
   - Verify S3 backups are replicated to secondary region.
   - Test restore process on non-prod environment monthly.

3. **Configuration Review**:
   - Verify `config/ttl.json` reflects intended policy.
   - If thresholds changed, verify rationale documented in CHANGELOG.
   - Ensure worker keys are rotated annually.

### Monthly Operations

1. **Disaster Recovery Drill**:
   - Simulate worker failure; verify fallback procedures.
   - Simulate snapshot storage failure; verify recovery steps.

2. **Performance Tuning**:
   - Analyze batch processing times; adjust `batchSize` if needed.
   - Review gas usage per entry; optimize if costs are high.
   - Adjust `BUMP_THRESHOLD` or `DEFAULT_TTL_EXTENSION` if policy objectives change.

3. **Security Audit**:
   - Verify worker signing keys are secure (HSM or sealed in AWS Secrets Manager).
   - Verify off-chain snapshots are encrypted at rest and in transit.
   - Review audit logs for anomalies or failed privilege escalations.

### Troubleshooting and Recovery

See [Archival Playbook](archival-playbook.md) for detailed troubleshooting steps and recovery procedures.

---

## Security Considerations

### Authorization and Signing

- **TTL Bump Worker**: Must sign `extend_ttl` calls with a dedicated worker key held in AWS Secrets Manager or HSM.
- **Archival Worker**: Must sign `mark_archived` calls; same or separate key per security policy.
- **Admin Deletion**: Admin must use hardware wallet or Ledger for signing delete operations.
- **On-Chain Verification**: Contract verifies caller signature; rejects unauthorized calls.

### Gas and Cost Control

- Worker respects `MAX_GAS_PER_BATCH` to prevent runaway costs.
- If gas price spikes, worker may fail; monitor and escalate.
- Snapshot storage costs monitored; alert if S3 usage exceeds forecast.

### Privacy and Data Protection

- Snapshots encrypted at rest with AES-256-GCM; encryption key in AWS Secrets Manager.
- PII redacted before snapshotting per `REDACTION_POLICY`.
- Snapshot access restricted to ops team; fine-grained IAM policies enforce least privilege.
- Audit logs use hash of entry_key (SHA-256) to avoid PII exposure in logs.

### Availability and Resilience

- Worker is idempotent; can be re-run safely after failure.
- Snapshot storage uses S3 with cross-region replication; 99.99% uptime SLA.
- Database (PostgreSQL) backed up hourly; daily snapshots retained 30 days.
- If worker fails, manual operator can trigger via CLI or API; see playbook.

### Monitoring and Alerting

- Worker runs logged to CloudWatch and Sentry.
- Alerts:
  - Worker fails 3+ times → PagerDuty critical alert.
  - TTL bump success rate drops below 95% → warning email.
  - Snapshot storage errors → critical alert; manual review required.
  - Gas usage exceeds 2x baseline → investigate optimization.

---

## Related Documentation

- [Archival Playbook](archival-playbook.md): On-call operator guide and troubleshooting procedures.
- [TTL Configuration Reference](../config/ttl.json): Complete configuration schema.
- [Audit Service](../src/audit/README.md): Hash-chain audit logging implementation.
- [BlockchainService](../src/services/blockchain-service.ts): On-chain contract interaction patterns.

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-08-25 | 1.0 | Initial policy document; TTL bumping and archival strategy. |

---

## Approval

- **Reviewed By**: Security Team, Ops Team
- **Approved By**: Engineering Lead
- **Effective Date**: 2026-08-25
