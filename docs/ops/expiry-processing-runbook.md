# Alert Runbook: Subscription Expiry Processing (`expiry-processing`)

> **Alert Class:** `expiry-processing`  
> **Paging Severity:** `alert` (P2 Incident)  
> **Job Description:** Daily cron job running at 02:00 UTC that updates subscription status to `expired` for active subscriptions whose end date / billing window has passed.

---

## 1. Overview & Thresholds

This job processes active subscriptions past their `next_billing_date` without valid renewal or payment, updating their state to `expired` and initiating cleanup workflows.

### Default Alert Thresholds
- **Warning (`P2` ticket):** 1 consecutive execution failure.
- **Critical (`P2` ticket):** 2 consecutive execution failures OR 3 failures in 1 hour.

Thresholds can be overridden via environment variables:
- `JOB_ALERT_EXPIRY_PROCESSING_CONSECUTIVE_FAILURES_WARNING`
- `JOB_ALERT_EXPIRY_PROCESSING_CONSECUTIVE_FAILURES_CRITICAL`
- `JOB_ALERT_EXPIRY_PROCESSING_FAILURES_PER_HOUR_CRITICAL`

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** Expired subscriptions remain marked as `active` in the system, potentially allowing unauthorized service access beyond paid periods.
- **Sentry Alert Tags:**
  - `alert_type: job_failure`
  - `job_id: expiry-processing`
  - `paging_severity: alert`
- **Log Pattern:**
  - `Background job failure recorded` with `jobId: expiry-processing`
  - `Error executing subscription expiry processing`

---

## 3. Diagnosis

### Step 1: Query Past-Due Active Subscriptions
Inspect database for active subscriptions past `next_billing_date`:
```sql
SELECT id, user_id, next_billing_date, status
FROM subscriptions
WHERE status = 'active' AND next_billing_date < NOW() - INTERVAL '1 day';
```

### Step 2: Inspect Execution Logs
Check logs for `Running scheduled expiry processing` and examine stack trace for thrown errors during transaction updates.

---

## 4. Remediation

### Action 1: Resolve Database Locks / Row Contention
- If database timeouts occurred due to heavy concurrent lock on `subscriptions`, resolve long-running queries or locks.

### Action 2: Trigger Expiry Sweep
Restart the backend service or trigger an manual expiry check via admin tooling.

### Action 3: Verify Subscriptions Updated
Re-run the diagnosis query to verify all expired subscriptions were transitioned to `expired` status.
