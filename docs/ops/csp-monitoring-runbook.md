# Alert Runbook: CSP Monitoring Jobs (`csp-monitoring`)

> **Alert Class:** `csp-monitoring`  
> **Paging Severity:** `warn` (P3 Monitor-Only)  
> **Job Description:** Recurring cron job running every 5 minutes that refreshes Content Security Policy (CSP) violation stats and evaluates security violation alerts.

---

## 1. Overview & Thresholds

This job processes incoming CSP report-to violation logs, aggregates metrics, and triggers security alerts if anomaly thresholds are exceeded.

### Default Alert Thresholds
- **Warning (`P3` monitor):** 2 consecutive execution failures.
- **Critical (`P3` monitor):** 4 consecutive execution failures OR 3 failures in 1 hour.

Thresholds can be overridden via environment variables:
- `JOB_ALERT_CSP_MONITORING_CONSECUTIVE_FAILURES_WARNING`
- `JOB_ALERT_CSP_MONITORING_CONSECUTIVE_FAILURES_CRITICAL`
- `JOB_ALERT_CSP_MONITORING_FAILURES_PER_HOUR_CRITICAL`

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** No direct user impact on frontend subscription operations. Security team visibility into CSP violation spikes or potential XSS injection attempts is delayed.
- **Sentry Alert Tags:**
  - `alert_type: job_failure`
  - `job_id: csp-monitoring`
  - `paging_severity: warn`
- **Log Pattern:**
  - `Background job failure recorded` with `jobId: csp-monitoring`
  - `CSP stats refresh job failed`

---

## 3. Diagnosis

### Step 1: Verify CSP Monitoring Flag
Ensure CSP monitoring is enabled:
```bash
echo $CSP_MONITORING_ENABLED
```
If set to `false`, the job is intentionally disabled.

### Step 2: Inspect Application Logs
Search logs for CSP stats refresh or alert evaluation failures:
```bash
grep "CSP stats refresh job" /var/log/syncro-backend.log
```
Check for database write errors on `csp_violation_stats` or `csp_incidents`.

---

## 4. Remediation

### Action 1: Restart Monitoring Jobs
If the CSP cron interval halted, restart monitoring jobs via application boot or service restart:
```bash
startCspMonitoringJobs()
```

### Action 2: Refer to Full CSP Incident Response Guide
For CSP violation analysis and policy rule tuning, refer to [CSP_INCIDENT_RESPONSE.md](../CSP_INCIDENT_RESPONSE.md).
