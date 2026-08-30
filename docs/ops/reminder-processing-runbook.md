# Alert Runbook: Reminder Processing (`reminder-processing`)

> **Alert Class:** `reminder-processing`  
> **Paging Severity:** `page` (P1 On-Call)  
> **Job Description:** Daily cron job executing at 09:00 UTC that delivers pending subscription reminder notifications (email, push, Telegram).

---

## 1. Overview & Thresholds

This job queries pending reminder schedules and dispatches notifications to users before upcoming subscription renewals.

### Default Alert Thresholds
- **Warning (`P1` page):** 1 consecutive execution failure OR 5 failures in 1 hour.
- **Critical (`P1` page):** 2 consecutive execution failures, 15 failures in 1 hour, OR 10 dead-letter queue (DLQ) entries within 24 hours.

Thresholds can be overridden via environment variables:
- `JOB_ALERT_REMINDER_PROCESSING_CONSECUTIVE_FAILURES_WARNING`
- `JOB_ALERT_REMINDER_PROCESSING_CONSECUTIVE_FAILURES_CRITICAL`
- `JOB_ALERT_REMINDER_PROCESSING_FAILURES_PER_HOUR_CRITICAL`
- `JOB_ALERT_REMINDER_PROCESSING_DLQ_COUNT_24H_CRITICAL`

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** Users do not receive timely renewal notifications before subscription billing dates, leading to unexpected charges or unwanted auto-renewals.
- **Sentry Alert Tags:**
  - `alert_type: job_failure`
  - `job_id: reminder-processing`
  - `paging_severity: page`
- **Log Pattern:**
  - `Background job failure recorded` with `jobId: reminder-processing`
  - `Error processing daily subscription reminders`

---

## 3. Diagnosis

Follow these diagnostic steps in order:

### Step 1: Check System Health and Active Alerts
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/admin/health
```
Verify whether `alerts` contains `reminder-processing` and check scheduler status.

### Step 2: Query Failed Items Endpoint
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  "https://api.example.com/api/admin/metrics/failed-items?type=reminder&limit=20"
```
Group failure logs by `error_message` to isolate root causes.

### Step 3: Identify Root Cause Categories
1. **Email/SMTP Failures:** `SMTPConnectionError`, `Invalid credentials`, or `ECONNREFUSED`. Check SMTP provider status and environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`).
2. **Push Notification Errors:** Web-push return codes 410/404 (expired/unregistered push subscriptions).
3. **Database Locks / DB Downtime:** Connection timeouts or table access errors on `reminder_schedules` or `subscriptions`.
4. **Scheduler Stalled:** Process did not trigger the 09:00 UTC tick. Check process uptime and container health.

---

## 4. Remediation

### Action 1: Fix Infrastructure Dependencies
- **SMTP Outage / Credentials:** Restore SMTP connection or update credentials in environment configuration, then restart the backend service.
- **Database Connection Issues:** Check Supabase status and pooler limits.

### Action 2: Trigger Manual Catch-Up Execution
Once the root cause is resolved, trigger a manual reminder processing pass via admin API:

```bash
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/reminders/process
```

### Action 3: Flush / Retry Queued Reminders
Trigger retry of stalled or transiently failed reminders:

```bash
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/reminders/retry
```

### Action 4: Verify Recovery
Check activity metrics to confirm pending reminders are decreasing and success rate returns to >99%:

```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/admin/metrics/ops-summary
```
