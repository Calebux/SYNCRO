# Archival and TTL Management Playbook

**For:** On-Call Operators and DevOps Engineers  
**Scope:** Troubleshooting, recovery, and manual intervention for TTL and archival workers  
**Version:** 1.0  
**Last Updated:** August 2026

---

## Quick Reference

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| TTL bump worker fails 3+ times | Contract address misconfigured or network issues | Check SOROBAN_CONTRACT_ADDRESS and network connectivity |
| Archival worker reports no entries | No expired subscriptions or grace period not elapsed | Verify subscription status and archival grace period config |
| High gas usage spikes | Batch size too large or contract method expensive | Reduce batchSize or maxGasPerBatch in config/ttl.json |
| Snapshots not storing | S3 permissions, encryption key, or storage backend misconfigured | Verify S3 bucket access, encryption key, and snapshotStorage config |
| Audit logs missing TTL events | Audit service not initialized or audit level set to minimal | Check auditLevel in config and service startup logs |

---

## Monitoring and Alerting

### Worker Health Checks

**Location:** CloudWatch Logs  
**Pattern:** Search for `ttl-bump-worker` or `archival-worker`

```bash
# CloudWatch Insights query for TTL worker errors
fields @timestamp, @message, @logStream
| filter @message like /ttl-bump-worker|archival-worker/
| filter ispresent(error) or @message like /failed/
| stats count() by @logStream
```

### Metrics to Monitor

1. **TTL Bump Worker Success Rate**
   - Target: >= 99%
   - Alert threshold: < 95%
   - Dimension: Namespace = `SYNCRO/TTL`, MetricName = `BumpSuccessRate`

2. **Archival Worker Success Rate**
   - Target: >= 98%
   - Alert threshold: < 90%
   - Dimension: Namespace = `SYNCRO/Archival`, MetricName = `ArchivalSuccessRate`

3. **TTL Bump Gas Cost**
   - Baseline: ~1000 gas per entry
   - Alert threshold: > 5000 gas per entry
   - Indicates: Possible contract regression or network congestion

4. **Archival Snapshot Storage Latency**
   - Baseline: < 2 seconds
   - Alert threshold: > 10 seconds
   - Indicates: S3/IPFS performance issues

### PagerDuty Alerts

**Critical Alert:** TTL or archival worker fails 3+ consecutive times
- **Action:** Page on-call operator immediately
- **Severity:** P1 (Critical)
- **Response Time:** 15 minutes

**Warning Alert:** TTL bump success rate drops below 95%
- **Action:** Send email to ops team
- **Severity:** P2 (High)
- **Response Time:** 1 hour

---

## Troubleshooting Procedures

### 1. TTL Worker Fails to Start or Run

#### Symptoms
- Logs show: `Error in TTL bump worker: ...`
- No TTL bumps recorded in audit logs
- Subscription TTLs expiring without extension

#### Diagnosis

```bash
# Check worker is registered in scheduler
grep -i "ttl.*bump.*scheduled" /var/log/ttl-bump-worker.log

# Check configuration is valid
cat config/ttl.json | jq '.ttl'

# Check contract address is configured
echo $SOROBAN_CONTRACT_ADDRESS
```

#### Resolution Steps

1. **Verify Configuration**
   ```bash
   # Validate config/ttl.json syntax
   node -e "console.log(JSON.stringify(require('./config/ttl.json'), null, 2))"
   
   # Check required env vars
   env | grep -E "SOROBAN_CONTRACT_ADDRESS|TTL_|ENABLE_BLOCKCHAIN"
   ```

2. **Check Blockchain Connectivity**
   ```bash
   # Test Soroban RPC connection
   curl -X POST "$SOROBAN_RPC_URL" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc": "2.0", "id": 1, "method": "getNetwork", "params": []}'
   
   # Expected: `"TESTNET"` or `"MAINNET"` or `"FUTURENET"`
   ```

3. **Check Contract Address**
   ```bash
   # Verify contract exists and is accessible
   curl -X POST "$SOROBAN_RPC_URL" \
     -H "Content-Type: application/json" \
     -d "{\"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"getLedgerEntries\", \"params\": [{\"contractId\": \"$SOROBAN_CONTRACT_ADDRESS\"}]}"
   ```

4. **Check Worker Key**
   ```bash
   # Ensure signing key is available
   if [ -z "$STELLAR_SECRET_KEY" ] && [ -z "$AGENT_MASTER_SEED" ]; then
     echo "ERROR: No signing key configured"
     exit 1
   fi
   ```

5. **Restart Worker**
   ```bash
   # If using systemd
   sudo systemctl restart ttl-bump-worker
   
   # If using Docker
   docker restart syncro-backend
   
   # Check logs
   journalctl -u ttl-bump-worker -f
   # or
   docker logs -f syncro-backend | grep ttl-bump-worker
   ```

#### If Problem Persists

- **Escalate:** Page on-call blockchain engineer
- **Mitigation:** Disable worker temporarily while investigating
  ```bash
  export TTL_ENABLE_TTL_BUMPING=false
  # Restart service
  ```
- **Document:** Create incident ticket with logs and steps taken

---

### 2. Archival Worker Fails or Snapshots Don't Store

#### Symptoms
- Logs show: `Failed to store snapshot` or `mark_archived failed`
- Expired subscriptions not being archived
- S3 upload errors in logs

#### Diagnosis

```bash
# Check archival is enabled
grep enableArchival config/ttl.json

# Check snapshot storage backend
grep snapshotStorage config/ttl.json

# Check snapshot bucket exists
aws s3 ls s3://$TTL_SNAPSHOT_BUCKET/

# Check encryption key is set
echo -n "$TTL_SNAPSHOT_ENCRYPTION_KEY" | wc -c
# Expected: 64 characters (32 bytes in hex)
```

#### Resolution Steps

1. **Verify S3 Configuration**
   ```bash
   # Test S3 access
   aws s3 ls s3://$TTL_SNAPSHOT_BUCKET/ --region $AWS_REGION
   
   # If fails: check IAM permissions
   aws iam get-user
   aws iam list-attached-user-policies --user-name <username>
   ```

2. **Verify Encryption Key**
   ```bash
   # Generate new key if missing
   openssl rand -hex 32 > /tmp/encryption.key
   export TTL_SNAPSHOT_ENCRYPTION_KEY=$(cat /tmp/encryption.key)
   
   # Store key in AWS Secrets Manager
   aws secretsmanager create-secret --name ttl/snapshot-encryption-key \
     --secret-string "$TTL_SNAPSHOT_ENCRYPTION_KEY"
   ```

3. **Check Snapshot Storage Backend**
   ```bash
   # If using local storage
   mkdir -p archives/
   chmod 755 archives/
   du -sh archives/
   
   # If using S3
   aws s3api head-bucket --bucket $TTL_SNAPSHOT_BUCKET
   ```

4. **Manually Trigger Archival Worker**
   ```bash
   # In development/test
   node -e "
     const { getArchivalWorker } = require('./src/workers/archival-worker');
     const { blockchainService } = require('./src/services/blockchain-service');
     (async () => {
       const worker = getArchivalWorker(blockchainService);
       const result = await worker.run();
       console.log(JSON.stringify(result, null, 2));
     })();
   "
   ```

#### If Problem Persists

- **Check RLS Policies:** Verify database row-level security doesn't block archival queries
  ```bash
  psql -c "SELECT * FROM pg_policies WHERE tablename = 'archival_index';"
  ```
- **Check Database Connectivity:** Ensure Supabase connection works
  ```bash
  psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM subscriptions WHERE status = 'expired';"
  ```
- **Escalate:** Page database administrator if storage or database issues

---

### 3. TTL Bumps Happening but Not Extending Enough

#### Symptoms
- Entries TTL increasing but not enough to prevent expiration
- Log shows: `newTtl is too small` or entries expiring soon after bumping
- Configuration mismatch suspected

#### Diagnosis

```bash
# Check DEFAULT_TTL_EXTENSION setting
grep defaultTtlExtension config/ttl.json

# Check BUMP_THRESHOLD setting (should bump before this time is left)
grep bumpThreshold config/ttl.json

# Verify math: extension should be > threshold for safety margin
# bumpThreshold < defaultTtlExtension
```

#### Resolution Steps

1. **Calculate Safe TTL Extension**
   ```bash
   # Current: 7 days threshold, 90 days extension
   # New: increase extension to 180 days for buffer
   
   # Update config/ttl.json
   sed -i 's/"defaultTtlExtension": 90/"defaultTtlExtension": 180/' config/ttl.json
   
   # Or use env var (overrides config file)
   export TTL_DEFAULT_EXTENSION_DAYS=180
   ```

2. **Adjust Bump Threshold**
   ```bash
   # If bumping too late, lower threshold (e.g., 3 days instead of 7)
   export TTL_BUMP_THRESHOLD_DAYS=3
   ```

3. **Verify New Settings**
   ```bash
   # Restart worker
   docker restart syncro-backend
   
   # Monitor next bump
   docker logs -f syncro-backend | grep "newTtl\|TTL extended"
   ```

#### Check TTL Calculation

```bash
# Test TTL calculation
node -e "
  const config = require('./src/config/ttl-config').getTTLConfig();
  const now = Math.floor(Date.now() / 1000);
  const newTtl = now + config.defaultTtlExtensionSeconds;
  console.log('Current time (seconds):', now);
  console.log('Extension (seconds):', config.defaultTtlExtensionSeconds);
  console.log('New TTL:', newTtl);
  console.log('Days extended:', (newTtl - now) / (24 * 60 * 60));
"
```

---

### 4. Archival Snapshots Not Encrypted

#### Symptoms
- Snapshots stored in plaintext (readable with: `cat archives/...`)
- Security audit failure: sensitive data visible in snapshots
- Configuration issue suspected

#### Diagnosis

```bash
# Check encryption is enabled in config
grep snapshotEncryption config/ttl.json

# Check encryption key is set
[ -z "$TTL_SNAPSHOT_ENCRYPTION_KEY" ] && echo "ERROR: Key not set" || echo "Key is set"

# Check snapshot file format
file archives/archival/*/*.snapshot
# Should show: encrypted binary (not text)
```

#### Resolution Steps

1. **Enable Snapshot Encryption**
   ```bash
   # Update config/ttl.json
   sed -i 's/"snapshotEncryption": false/"snapshotEncryption": true/' config/ttl.json
   
   # Or use env var
   export TTL_SNAPSHOT_ENCRYPTION=true
   ```

2. **Set or Rotate Encryption Key**
   ```bash
   # Generate new 256-bit key
   NEWKEY=$(openssl rand -hex 32)
   export TTL_SNAPSHOT_ENCRYPTION_KEY="$NEWKEY"
   
   # Store in AWS Secrets Manager
   aws secretsmanager update-secret --secret-id ttl/snapshot-encryption-key \
     --secret-string "$NEWKEY"
   ```

3. **Redact Sensitive Fields**
   ```bash
   # Enable field redaction
   export TTL_REDACT_SENSITIVE_FIELDS=true
   ```

4. **Re-archive Old Snapshots** (Optional, for sensitive data)
   ```bash
   # Manually delete old unencrypted snapshots
   rm -f archives/archival/*/*.snapshot
   
   # Restart worker to re-archive
   ```

---

### 5. Audit Logs Missing or Incomplete

#### Symptoms
- No TTL events in audit logs
- Audit service not logging extend_ttl or mark_archived actions
- Compliance audit fails: missing TTL history

#### Diagnosis

```bash
# Check audit logs exist
psql "$DATABASE_URL" -c \
  "SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'extend_ttl' OR action LIKE 'archival%';"

# Check audit service is running
grep -i audit /var/log/backend.log | tail -20

# Check audit level in config
grep auditLevel config/ttl.json
```

#### Resolution Steps

1. **Set Audit Level to Full**
   ```bash
   export TTL_AUDIT_LEVEL=full
   ```

2. **Ensure Audit Service Initialized**
   ```typescript
   // In backend startup, verify audit service is initialized before workers
   const auditService = getAuditService();
   await auditService.initialize();
   ```

3. **Check Database Connection**
   ```bash
   psql "$DATABASE_URL" -c "SELECT 1;" # Should return 1
   ```

4. **Verify Hash Chain Integrity**
   ```bash
   node -e "
     const { verifyAuditChain } = require('./src/services/audit-service');
     (async () => {
       const isValid = await verifyAuditChain();
       console.log('Audit chain valid:', isValid);
     })();
   "
   ```

---

### 6. Rate Limiting Preventing TTL Bumps

#### Symptoms
- Worker runs but skips many entries: `RATE_LIMIT_EXCEEDED`
- Entries not getting bumped on schedule
- Logs show: `Entry rate limit exceeded`

#### Diagnosis

```bash
# Check rate limit config
grep "bumpsPerDay\|archivals" config/ttl.json

# Check how many entries were skipped
grep "RATE_LIMIT_EXCEEDED" /var/log/ttl-bump-worker.log | wc -l
```

#### Resolution Steps

1. **Increase Bumps Per Day Limit**
   ```bash
   # Current: 2 bumps per day per entry
   # Increase to 3-4 for more flexibility
   sed -i 's/"bumpsPerDay": 2/"bumpsPerDay": 4/' config/ttl.json
   ```

2. **Increase Batch Size**
   ```bash
   # Current: 50 entries per batch
   # If mostly skipping due to rate limits, can process more per run
   sed -i 's/"batchSize": 50/"batchSize": 100/' config/ttl.json
   ```

3. **Reduce Bump Interval**
   ```bash
   # Current: 24 hours min between bumps
   # Reduce to 12 hours if entries need frequent extensions
   export TTL_MIN_BUMP_INTERVAL_HOURS=12
   ```

4. **Restart Worker and Monitor**
   ```bash
   docker restart syncro-backend
   docker logs -f syncro-backend | grep "processed\|bumped\|skipped"
   ```

---

## Manual Operations

### Manually Extend TTL for an Entry

```bash
# Use admin API endpoint (if available)
curl -X POST "http://localhost:3000/admin/ttl/extend" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entryKey": "0xabcd1234...",
    "newTtl": 1234567890,
    "reason": "manual_extension_for_emergency_renewal"
  }'

# Or use direct service call (development only)
node -e "
  const { blockchainService } = require('./src/services/blockchain-service');
  (async () => {
    const result = await blockchainService.extendTTL('0xabcd1234...', 1234567890);
    console.log('Extended:', result);
  })();
"
```

### Manually Archive an Entry

```bash
# Use admin API endpoint (if available)
curl -X POST "http://localhost:3000/admin/archival/archive" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entryKey": "0xabcd1234...",
    "reason": "manual_archival_for_cleanup"
  }'

# Or use direct service call (development only)
node -e "
  const { getArchiver } = require('./src/archival');
  const { blockchainService } = require('./src/services/blockchain-service');
  (async () => {
    const archiver = getArchiver(blockchainService);
    const result = await archiver.archiveEntry({
      entryKey: '0xabcd1234...',
      entryType: 'subscription',
      expiryTimestamp: new Date().toISOString(),
      entryState: { id: 'sub_123' },
      auditTrail: []
    }, 'manual-admin');
    console.log('Archived:', result);
  })();
"
```

### Retrieve Archived Snapshot

```bash
# Use admin API endpoint (if available)
curl "http://localhost:3000/admin/archival/snapshots/0xabcd1234..." \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq .

# Or query database directly
psql "$DATABASE_URL" -c \
  "SELECT * FROM archival_index WHERE entry_key = '0xabcd1234...';"

# Retrieve snapshot from S3
aws s3 cp \
  s3://$TTL_SNAPSHOT_BUCKET/archival/abcd/0xabcd1234.../hash.snapshot \
  /tmp/snapshot.json.enc
```

---

## Disaster Recovery

### Full Worker Recovery (Nuclear Option)

**Use only if workers are in unrecoverable state.**

```bash
# 1. Stop all workers
export TTL_ENABLE_TTL_BUMPING=false
export TTL_ENABLE_ARCHIVAL=false
docker restart syncro-backend

# 2. Clear cached state (if applicable)
redis-cli FLUSHDB --async  # WARNING: clears all cache

# 3. Manually reprocess unfinished work
node -e "
  const { getTTLBumpWorker } = require('./src/workers/ttl-bump-worker');
  const { blockchainService } = require('./src/services/blockchain-service');
  (async () => {
    const worker = getTTLBumpWorker(blockchainService);
    const result = await worker.run();
    console.log('Manual run result:', result);
    process.exit(0);
  })();
"

# 4. Re-enable workers
export TTL_ENABLE_TTL_BUMPING=true
export TTL_ENABLE_ARCHIVAL=true
docker restart syncro-backend

# 5. Verify recovery
docker logs syncro-backend | grep "TTL bump\|archival" | tail -20
```

### Database Recovery

If archival or audit tables are corrupted:

```bash
# 1. Backup current tables
pg_dump $DATABASE_URL --table archival_index > /backup/archival_index.sql
pg_dump $DATABASE_URL --table audit_logs > /backup/audit_logs.sql

# 2. Verify table structure
psql "$DATABASE_URL" -c "\d archival_index"

# 3. Check for orphaned records
psql "$DATABASE_URL" -c "
  SELECT * FROM archival_index
  WHERE archival_timestamp > now() - interval '1 day'
  ORDER BY archival_timestamp DESC
  LIMIT 10;
"

# 4. If needed, recreate table (DESTRUCTIVE!)
psql "$DATABASE_URL" -c "DROP TABLE archival_index CASCADE;"
# Then run migration to recreate schema
```

---

## Escalation Path

1. **Tier 1:** On-call backend engineer
   - Can diagnose configuration and log issues
   - Can restart services and trigger manual runs

2. **Tier 2:** Backend team lead
   - Can modify configuration and deploy changes
   - Can investigate blockchain service failures

3. **Tier 3:** Blockchain engineer
   - Can debug contract interactions
   - Can coordinate with Stellar network team

4. **Tier 4:** Database team (if database issues)
   - Can investigate PostgreSQL/Supabase issues
   - Can recover from data corruption

---

## Post-Incident Checklist

After resolving a TTL/archival incident:

- [ ] Document root cause in incident ticket
- [ ] Update this runbook if new issue patterns found
- [ ] Review logs for similar issues in past 7 days
- [ ] Check if issue affects other components (e.g., webhook retries, expiry service)
- [ ] Update monitoring/alerting if gap was found
- [ ] Schedule postmortem if high-severity incident
- [ ] Implement preventive measures (e.g., additional validation, new alerts)

---

## Contact and Escalation

- **Slack:** #oncall or #engineering
- **PagerDuty:** Search "TTL" or "Archival"
- **Ops Handbook:** See [Runbook Index](./README.md)
- **Emergency:** Page on-call lead (+1-555-XXX-XXXX)
