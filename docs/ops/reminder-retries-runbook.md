# Alert Runbook: Reminder Retries (`reminder-retries`)

> **Alert Class:** `reminder-retries`  
> **Paging Severity:** `page` (P1 On-Call)  
> **Job Description:** Every-30-minute cron job that retries failed notification deliveries for pending subscription reminders.

---

## 1. Overview & Thresholds

This job processes retryable failed notification attempts (e.g. temporary SMTP errors, rate-limited push API calls) until max retries are reached or DLQ escalation occurs.

### Default Alert Thresholds
- **Warning (`P1` page):** 2 consecutive failures, 10 failures/hr, OR 10 DLQ items in 24 hours.
- **Critical (`P1` page):** 3 consecutive failures, 25 failures/hr, OR 50 DLQ items in 24 hours.

Thresholds can be overridden via environment variables:
- `JOB_ALERT_REMINDER_RETRIES_CONSECUTIVE_FAILURES_WARNING`
- `JOB_ALERT_REMINDER_RETRIES_CONSECUTIVE_FAILURES_CRITICAL`
- `JOB_ALERT_REMINDER_RETRIES_FAILURES_PER_HOUR_CRITICAL`
- `JOB_ALERT_REMINDER_RETRIES_DLQ_COUNT_24H_CRITICAL`

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** Delayed delivery of notification retries, potentially resulting in un-retried delivery failures reaching dead-letter state.
- **Sentry Alert Tags:**
  - `alert_type: job_failure`
  - `job_id: reminder-retries`
  - `paging_severity: page`
- **Log Pattern:**
  - `Background job failure recorded` with `jobId: reminder-retries`
  - `Error executing reminder retries`

---

## 3. Diagnosis

### Step 1: Check Retry Failure Metrics
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  "https://api.example.com/api/admin/metrics/failed-items?type=reminder&limit=50"
```

### Step 2: Check Dead-Letter Queue Backlog
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/notifications/dead-letter/stats
```

### Step 3: Analyze Provider Error Patterns
- **SMTP Auth/Rate Limit:** Look for 421 / 451 SMTP responses.
- **Push Notification Expired Credentials:** VAPID keys invalid or push payload malformed.
- **Third-Party API Outages:** Check external service status for Telegram bot API or web-push gateways.

---

## 4. Remediation

### Action 1: Fix Upstream Notification Gateway
- Restore third-party API credentials, resolve network blockages, or un-throttle SMTP server rate limits.

### Action 2: Trigger Manual Retry Cycle
Execute manual retry sweep via admin endpoint:

```bash
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/reminders/retry
```

### Action 3: Replay Dead-Letter Queue Items
For items escalated to the notification dead-letter queue, trigger replay:

```bash
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/notifications/dead-letter/replay-all
```
