# Alert Runbook: Blockchain Event Listener (`event-listener`)

> **Alert Class:** `event-listener`  
> **Paging Severity:** `page` (P1 On-Call)  
> **Job Description:** Continuous background poller that monitors Soroban Stellar smart contract events to synchronize subscription renewal states on-chain.

---

## 1. Overview & Thresholds

This service subscribes to Stellar/Soroban RPC event streams to update local database state when on-chain renewal transactions, payments, or channel state transitions occur.

### Default Alert Thresholds
- **Warning (`P1` page):** 5 consecutive poll failures OR 10 failures in 1 hour.
- **Critical (`P1` page):** 10 consecutive poll failures OR 30 failures in 1 hour.

Thresholds can be overridden via environment variables:
- `JOB_ALERT_EVENT_LISTENER_CONSECUTIVE_FAILURES_WARNING`
- `JOB_ALERT_EVENT_LISTENER_CONSECUTIVE_FAILURES_CRITICAL`
- `JOB_ALERT_EVENT_LISTENER_FAILURES_PER_HOUR_CRITICAL`

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** On-chain renewal payments and subscription state changes do not sync to SYNCRO backend DB, causing state drift between smart contracts and application UI.
- **Sentry Alert Tags:**
  - `alert_type: job_failure`
  - `job_id: event-listener`
  - `paging_severity: page`
- **Log Pattern:**
  - `Soroban RPC polling failure`
  - `Failed to fetch contract events from RPC node`
  - `Event listener consecutive failure count threshold reached`

---

## 3. Diagnosis

### Step 1: Query Event Listener Health Status
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/admin/health
```
Check `eventListener.status` and `eventListener.reason`.

### Step 2: Check Failed Blockchain Events
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  "https://api.example.com/api/admin/metrics/failed-items?type=blockchain&limit=20"
```

### Step 3: Verify Soroban RPC & Network Connectivity
1. Test reachability of `STELLAR_NETWORK_URL` (RPC endpoint).
2. Validate `SOROBAN_CONTRACT_ADDRESS` matches deployed contract address.
3. Check RPC rate limits or RPC node out-of-sync status.

---

## 4. Remediation

### Action 1: Fallback Soroban RPC Endpoint
If primary RPC node is failing, update `STELLAR_NETWORK_URL` to secondary RPC endpoint and restart backend service:
```bash
export STELLAR_NETWORK_URL="https://stellar-rpc-backup.example.com"
```

### Action 2: Trigger Manual State Re-Sync
Force a re-sync for affected subscriptions:
```bash
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/subscriptions/:id/retry-sync
```

### Action 3: Verify Auto-Recovery
The event listener is designed to auto-recover with exponential backoff after RPC connectivity is restored. Verify listener status returns to `healthy`:
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/admin/health
```
Confirm `eventListener.status` is `healthy`.
