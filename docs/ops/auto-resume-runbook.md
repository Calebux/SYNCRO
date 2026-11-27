# Alert Runbook: Auto-Resume Subscriptions (`auto-resume`)

> **Alert Class:** `auto-resume`  
> **Paging Severity:** `alert` (P2 Incident)  
> **Job Description:** Daily cron job running at 06:00 UTC that resumes paused subscriptions whose scheduled `resume_at` timestamp has passed.

---

## 1. Overview & Thresholds

This job queries subscriptions with status `paused` where `resume_at <= NOW()` and automatically resumes them, notifying users and re-activating billing schedules.

### Default Alert Thresholds
- **Warning (`P2` ticket):** 1 consecutive failure OR 3 failures in 1 hour.
- **Critical (`P2` ticket):** 2 consecutive failures OR 10 failures in 1 hour.

Thresholds can be overridden via environment variables:
- `JOB_ALERT_AUTO_RESUME_CONSECUTIVE_FAILURES_WARNING`
- `JOB_ALERT_AUTO_RESUME_CONSECUTIVE_FAILURES_CRITICAL`
- `JOB_ALERT_AUTO_RESUME_FAILURES_PER_HOUR_CRITICAL`

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** Paused subscriptions whose pause period has ended remain paused instead of automatically resuming, causing service interruption or missed renewals.
- **Sentry Alert Tags:**
  - `alert_type: job_failure`
  - `job_id: auto-resume`
  - `paging_severity: alert`
- **Log Pattern:**
  - `Background job failure recorded` with `jobId: auto-resume`
  - `[auto-resume] Failed to execute auto-resume job`

---

## 3. Diagnosis

### Step 1: Check Paused Subscriptions Pending Resume
```sql
SELECT id, user_id, status, resume_at
FROM subscriptions
WHERE status = 'paused' AND resume_at <= NOW();
```

### Step 2: Check Logs for Specific Subscription Errors
Inspect application logs for `[auto-resume]` to identify whether a specific subscription failed during `resumeSubscription` execution (e.g. payment method failure, invalid user status).

---

## 4. Remediation

### Action 1: Fix Underlying Subscription Service Exception
- Handle individual invalid subscription states so one bad subscription record does not block batch auto-resume execution.

### Action 2: Manually Resume Stalled Subscriptions
For affected subscriptions, trigger manual resume via application API or admin tool:
```bash
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/subscriptions/:id/resume
```

### Action 3: Verify Recovery
Verify no paused subscriptions remain with `resume_at <= NOW()`.
