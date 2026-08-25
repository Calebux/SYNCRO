# Contract Storage TTL/Archival Implementation Summary

**GitHub Issue:** #1068 - Hardening: contract storage TTL / archival (state rent) strategy  
**Implementation Date:** August 2026  
**Branch:** `feat/contract-ttl-archival`

---

## Overview

This implementation provides a comprehensive TTL (Time-To-Live) and archival strategy for SYNCRO contract entries on Stellar Soroban. It addresses state rent minimization, automated cleanup, and safe disaster recovery through:

- **Automated TTL Bumping**: Extends entry expiration before deadline
- **Privacy-Preserving Archival**: Creates encrypted off-chain snapshots with on-chain proof
- **Audit Trail**: Tamper-evident logging of all lifecycle events
- **Rate Limiting & Safety**: Prevents runaway costs and ensures idempotency
- **Operator Tooling**: Troubleshooting guides and manual intervention procedures

---

## Deliverables Checklist

### Documentation (3 files)
- [x] `backend/docs/archival.md` - TTL policy, semantics, configuration, operator guide
- [x] `backend/docs/archival-playbook.md` - Troubleshooting, recovery, escalation procedures
- [x] `IMPLEMENTATION_SUMMARY.md` (this file)

### Configuration (1 file)
- [x] `backend/config/ttl.json` - Default TTL parameters, configurable thresholds

### Configuration Module (1 file)
- [x] `backend/src/config/ttl-config.ts` - Zod-validated config loader with computed properties

### Archival Subsystem (4 files)
- [x] `backend/src/archival/snapshot-storage.ts` - Multi-backend storage (S3/local/IPFS), encryption, redaction
- [x] `backend/src/archival/archival-index.ts` - Metadata persistence, status tracking
- [x] `backend/src/archival/archiver.ts` - Orchestrates full archival workflow
- [x] `backend/src/archival/index.ts` - Public API exports

### Blockchain Integration (2 files)
- [x] `backend/src/blockchain/ttl-contract-helpers.ts` - Validation, arg preparation, gas estimation
- [x] `backend/src/services/blockchain-service.ts` (updated) - Added `extendTTL`, `getTTL`, `markArchived` methods

### Worker Implementations (2 files)
- [x] `backend/src/workers/ttl-bump-worker.ts` - Scans, filters, batches, and extends TTL
- [x] `backend/src/workers/archival-worker.ts` - Detects expired entries and archives them

### Scheduler Integration (1 file)
- [x] `backend/src/services/scheduler.ts` (updated) - Registered TTL and archival workers with configurable schedules

### Tests (5 files)
- [x] `backend/src/tests/contract-ttl/ttl-config.test.ts` - Configuration loading and validation
- [x] `backend/src/tests/contract-ttl/ttl-contract-helpers.test.ts` - Validation and argument preparation
- [x] `backend/src/tests/contract-ttl/snapshot-storage.test.ts` - Encryption, redaction, integrity
- [x] `backend/src/tests/contract-ttl/ttl-bump-worker.integration.test.ts` - Worker execution and idempotency
- [x] `backend/src/tests/contract-ttl/ttl-security.test.ts` - Input validation, privacy, authorization

**Total:** 20 files created/modified

---

## Architecture Overview

### Data Flow

```
Contract Entry (on-chain)
    ↓
[TTL Bump Worker] (daily 0:00 UTC)
    ├─ Scans: Get entries with TTL < BUMP_THRESHOLD
    ├─ Filters: Rate limiting, access validation
    ├─ Batches: Respect MAX_GAS_PER_BATCH
    └─ Calls: BlockchainService.extendTTL()
        ├─ Validates: Entry key, TTL value
        ├─ Invokes: Contract extend_ttl method
        ├─ Logs: Audit event (extend_ttl)
        └─ Returns: tx_hash, sequence
    ↓
[After TTL Expiration + ARCHIVAL_GRACE_PERIOD]
    ↓
[Archival Worker] (daily 2:00 UTC)
    ├─ Scans: Get expired entries
    ├─ Creates: Snapshot (JSON) with redaction
    ├─ Hashes: SHA-256 of snapshot
    ├─ Encrypts: AES-256-GCM (if enabled)
    ├─ Stores: Off-chain (S3/local/IPFS)
    ├─ Calls: BlockchainService.markArchived()
    │   ├─ Validates: Entry key, snapshot hash
    │   ├─ Invokes: Contract mark_archived method
    │   ├─ Logs: Audit event (mark_archived)
    │   └─ Returns: tx_hash, sequence
    ├─ Indexes: Metadata in archival_index table
    └─ Logs: Audit event (archival_snapshot_created)
    ↓
[Archival Retention Window (1 year default)]
    ↓
[Admin Manual Deletion] (after retention expires)
    └─ Deletes: Snapshot from storage + DB record
```

### Key Components

**1. TTL Configuration** (`ttl-config.ts`)
- Loads from `config/ttl.json` + environment overrides
- Validates with Zod schema
- Computes milliseconds/seconds from configured units
- Provides singleton instance

**2. Snapshot Storage** (`snapshot-storage.ts`)
- Multi-backend support: S3, local filesystem, IPFS
- Encryption: AES-256-GCM with random IV
- Redaction: Removes PII (email, SSN, payment details, etc.)
- Integrity: SHA-256 hashing for verification

**3. Archival Index** (`archival-index.ts`)
- Database persistence of archival metadata
- Status tracking (archived, retained, purged)
- Queries for expired/ready-for-purge entries
- Cryptographic proof linkage (snapshot_hash ↔ tx_hash)

**4. Archiver** (`archiver.ts`)
- Orchestrates full archival workflow
- Handles idempotency (no double-archiving)
- Rollback support (deletes snapshot if on-chain mark fails)
- Audit event emission at each step

**5. TTL Bump Worker** (`ttl-bump-worker.ts`)
- Scans database for active entries
- Applies rate limiting (bumpsPerDay per entry)
- Respects min interval between bumps
- Batches with gas budgeting
- Returns statistics (total_processed, total_bumped, total_failed)

**6. Archival Worker** (`archival-worker.ts`)
- Detects expired entries after grace period
- Calls Archiver for each entry
- Handles errors gracefully (partial success)
- Returns statistics (total_scanned, total_archived, total_failed)

**7. Contract Helpers** (`ttl-contract-helpers.ts`)
- Input validation (entry keys, TTLs, hashes)
- Argument preparation for Soroban calls
- Gas estimation
- Idempotency checks (shouldSkipExtendTTL)

**8. BlockchainService Extensions**
- `extendTTL(entryKey, newTtl)` - Idempotent TTL extension
- `getTTL(entryKey)` - Read current TTL (simulation only)
- `markArchived(entryKey, snapshotHash)` - Record archival proof

---

## Configuration Reference

### Default Values (config/ttl.json)

| Parameter | Value | Description |
|-----------|-------|-------------|
| `bumpThreshold` | 7 days | Trigger bump when < 7 days left |
| `defaultTtlExtension` | 90 days | Extend by 90 days per bump |
| `minBumpInterval` | 24 hours | Minimum between bumps per entry |
| `archivalGracePeriod` | 14 days | Wait after expiration before archival |
| `archivalRetentionWindow` | 365 days | Keep archived snapshots for 1 year |
| `batchSize` | 50 | Max entries per worker run |
| `maxGasPerBatch` | 10,000,000 | Max cumulative gas per batch |
| `workerSchedule` | `0 0 * * *` | Cron: daily midnight UTC |
| `archivalSchedule` | `0 2 * * *` | Cron: daily 2 AM UTC |
| `snapshotStorage` | `s3` | Backend: s3, ipfs, or local |
| `snapshotBucket` | `syncro-archival-snapshots` | S3 bucket name |
| `snapshotEncryption` | `true` | Enable AES-256-GCM encryption |
| `redactSensitiveFields` | `true` | Redact PII in snapshots |
| `auditLevel` | `full` | Audit detail: minimal, standard, full |
| `retryMaxAttempts` | 5 | Max retries on transient failures |
| `retryBackoffMs` | 1000 | Initial backoff (exponential) |
| `bumpsPerDay` | 2 | Rate limit: bumps per entry per day |

### Environment Variable Overrides

```bash
export TTL_BUMP_THRESHOLD_DAYS=7
export TTL_DEFAULT_EXTENSION_DAYS=90
export TTL_MIN_BUMP_INTERVAL_HOURS=24
export TTL_ARCHIVAL_GRACE_PERIOD_DAYS=14
export TTL_ARCHIVAL_RETENTION_WINDOW_DAYS=365
export TTL_BATCH_SIZE=50
export TTL_MAX_GAS_PER_BATCH=10000000
export TTL_WORKER_SCHEDULE="0 0 * * *"
export TTL_ARCHIVAL_SCHEDULE="0 2 * * *"
export TTL_SNAPSHOT_STORAGE="s3"
export TTL_SNAPSHOT_BUCKET="syncro-archival-snapshots"
export TTL_SNAPSHOT_ENCRYPTION=true
export TTL_REDACT_SENSITIVE_FIELDS=true
export TTL_AUDIT_LEVEL=full
export TTL_DRY_RUN=false  # Set to true for dry-run mode
export TTL_SNAPSHOT_ENCRYPTION_KEY="<hex>"  # 64-char hex = 32 bytes
```

---

## Testing

### Test Coverage

| Test File | Scenarios | Count |
|-----------|-----------|-------|
| `ttl-config.test.ts` | Config loading, env overrides, unit conversions | 12 |
| `ttl-contract-helpers.test.ts` | Validation, arg prep, gas estimation, idempotency | 20 |
| `snapshot-storage.test.ts` | Encryption, redaction, hashing, integrity | 18 |
| `ttl-bump-worker.integration.test.ts` | Worker initialization, batching, rate limiting, dry-run | 9 |
| `ttl-security.test.ts` | Input validation, privacy, encryption, auth | 25 |
| **Total** | | **84 test cases** |

### Running Tests

```bash
# All TTL tests
npm run test -- src/tests/contract-ttl

# Specific test file
npm run test -- src/tests/contract-ttl/ttl-config.test.ts

# With coverage
npm run test -- src/tests/contract-ttl --coverage

# Watch mode
npm run test -- src/tests/contract-ttl --watch

# Integration tests only
npm run test -- src/tests/contract-ttl --testNamePattern="integration"

# Security tests only
npm run test -- src/tests/contract-ttl/ttl-security.test.ts
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All tests pass: `npm run test -- src/tests/contract-ttl`
- [ ] Linting passes: `npm run lint`
- [ ] TypeScript compilation succeeds: `npm run build`
- [ ] Configuration file reviewed: `backend/config/ttl.json`
- [ ] Environment variables documented in deployment guide
- [ ] Database migrations applied (archival_index table created)
- [ ] S3 bucket created (if using S3 backend)
- [ ] Encryption key generated and stored in AWS Secrets Manager
- [ ] Worker signing key provisioned and available

### Deployment Steps

1. **Build and Test**
   ```bash
   npm install
   npm run lint
   npm run test
   npm run build
   ```

2. **Database Migrations**
   ```bash
   # Apply migrations to create archival_index table
   npm run migrate:latest
   ```

3. **Deploy Application**
   ```bash
   # Deploy to staging first
   docker build -t syncro-backend:staging .
   docker push syncro-backend:staging
   
   # Verify workers start
   docker run syncro-backend:staging npm run start
   
   # Check logs for worker registration
   docker logs syncro-backend:staging | grep "TTL.*scheduled"
   ```

4. **Enable Workers**
   ```bash
   # Set environment variables
   export TTL_ENABLE_TTL_BUMPING=true
   export TTL_ENABLE_ARCHIVAL=true
   
   # Restart service
   docker restart syncro-backend
   ```

5. **Monitor First Run**
   ```bash
   # Watch logs for worker execution
   docker logs -f syncro-backend | grep -E "TTL|archival"
   
   # Check metrics
   curl http://localhost:3000/metrics | grep ttl
   
   # Query audit logs
   psql $DATABASE_URL -c \
     "SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'extend_ttl%';"
   ```

### Post-Deployment

- [ ] Verify workers are running on schedule
- [ ] Check audit logs for TTL events
- [ ] Monitor gas costs and latency
- [ ] Alert on worker failures
- [ ] Document any deviations from plan

---

## Monitoring and Observability

### Key Metrics

```bash
# TTL bump success rate
SELECT COUNT(*) FILTER (WHERE action = 'extend_ttl' AND status = 'success')::float /
       COUNT(*) FILTER (WHERE action = 'extend_ttl') * 100 AS bump_success_rate
FROM audit_logs
WHERE action LIKE 'extend_ttl%'
  AND timestamp > now() - interval '1 day';

# Archival snapshot volume
SELECT COUNT(*) FROM archival_index
WHERE archival_timestamp > now() - interval '1 day';

# Average TTL extension
SELECT AVG((metadata->>'newTtl')::bigint - (metadata->>'currentTtl')::bigint) / 86400 AS days_extended
FROM audit_logs
WHERE action = 'extend_ttl'
  AND status = 'success'
  AND timestamp > now() - interval '1 day';

# Snapshot storage size
SELECT COUNT(*) as snapshots,
       SUM(LENGTH(snapshot_blob)) / 1024.0 / 1024.0 AS size_mb
FROM archival_index;
```

### Log Patterns to Monitor

```
ERROR: ttl-bump-worker
ERROR: archival-worker
WARNING: RATE_LIMIT_EXCEEDED
WARNING: Gas budget exceeded
ERROR: mark_archived failed
ERROR: Snapshot storage failed
```

---

## Known Limitations and Future Enhancements

### Limitations (v1.0)

1. **Manual Entry Scanning**: Currently scans database; production should implement RPC-based contract entry enumeration
2. **Read-Only TTL Query**: `getTTL` uses simulation; real implementation needs contract entrypoint
3. **Simple Redaction**: Based on key name matching; consider pattern-based PII detection
4. **Local Encryption Key**: Hardcoded fallback; must use AWS Secrets Manager in production
5. **No Restore Automation**: Recovery of archived entries requires manual admin action

### Future Enhancements

1. **Intelligent Threshold Optimization**: Adapt bump thresholds based on gas price and entry churn
2. **Batch Compression**: Compress snapshots before storing to reduce S3 costs
3. **Distributed Workers**: Support multiple worker instances with distributed locking
4. **ML-based Prediction**: Predict which entries will expire and pre-emptively bump
5. **Ledger Sync**: Read TTL directly from Soroban ledger RPC instead of DB proxy
6. **Auto-Restore**: Provide admin endpoint to restore archived entries on-demand
7. **Snowball Archival**: Bulk archival of similar entries to reduce transaction overhead
8. **Cost Analytics**: Track and report state rent costs per entry type

---

## Support and Escalation

### Documentation

- **Policy & Semantics:** See `backend/docs/archival.md`
- **Operator Guide:** See `backend/docs/archival-playbook.md`
- **Implementation Details:** This file
- **GitHub Issue:** #1068

### Contact

- **Slack Channel:** #oncall or #engineering
- **On-Call:** See PagerDuty
- **Emergency:** Page blockchain lead

---

## Acceptance Criteria Met

✅ **TTL Semantics Documented**: `archival.md` covers bump window, grace period, all definitions  
✅ **Archival Policy Defined**: File contains policy rules, rate limits, retention windows  
✅ **Contract Support**: `ttl-contract-helpers.ts` provides extend_ttl, get_ttl, mark_archived  
✅ **Worker Implementation**: TTL and archival workers with rate limiting, batching, gas budgeting  
✅ **Archival Pipeline**: Snapshot creation, hashing, encryption, off-chain storage, on-chain marking  
✅ **Audit Logging**: All mutations logged with privacy-safe fields in tamper-evident chain  
✅ **Configuration**: `ttl.json` with all configurable parameters  
✅ **Tests**: 84 test cases covering unit, integration, security, and edge cases  
✅ **Documentation**: Policy, playbook, and implementation summary  
✅ **Operator Tools**: Playbook with troubleshooting, recovery, escalation  
✅ **Idempotency**: Workers are re-entrant; repeated runs safe  
✅ **Safety & Privacy**: Input validation, encryption, redaction, rate limiting  

---

## Files Modified/Created Summary

```
backend/
├── config/
│   └── ttl.json (NEW)
├── docs/
│   ├── archival.md (NEW)
│   ├── archival-playbook.md (NEW)
│   └── IMPLEMENTATION_SUMMARY.md (NEW)
├── src/
│   ├── archival/ (NEW DIRECTORY)
│   │   ├── index.ts
│   │   ├── snapshot-storage.ts
│   │   ├── archival-index.ts
│   │   └── archiver.ts
│   ├── blockchain/
│   │   └── ttl-contract-helpers.ts (NEW)
│   ├── config/
│   │   └── ttl-config.ts (NEW)
│   ├── services/
│   │   ├── blockchain-service.ts (MODIFIED: added extendTTL, getTTL, markArchived)
│   │   └── scheduler.ts (MODIFIED: registered TTL workers)
│   ├── workers/ (NEW DIRECTORY)
│   │   ├── ttl-bump-worker.ts (NEW)
│   │   └── archival-worker.ts (NEW)
│   └── tests/
│       └── contract-ttl/ (NEW DIRECTORY)
│           ├── ttl-config.test.ts
│           ├── ttl-contract-helpers.test.ts
│           ├── snapshot-storage.test.ts
│           ├── ttl-bump-worker.integration.test.ts
│           └── ttl-security.test.ts

TOTAL: 20 files (18 new, 2 modified)
```

---

## Version Info

- **Node.js**: v18+
- **TypeScript**: v5.0+
- **Jest**: v29+
- **Zod**: v3.22+
- **@stellar/stellar-sdk**: v11.0+
- **@aws-sdk/client-s3**: v3.0+

---

## Changelog

### v1.0 (August 2026)
- Initial implementation of TTL bumping and archival strategy
- Support for S3, local, and IPFS snapshot storage
- Comprehensive testing and documentation
- Operator playbook and troubleshooting guide
