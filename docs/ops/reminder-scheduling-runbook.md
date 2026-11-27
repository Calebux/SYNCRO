# Alert Runbook: Reminder Scheduling (`reminder-scheduling`)

> **Alert Class:** `reminder-scheduling`  
> **Paging Severity:** `page` (P1 On-Call)  
> **Job Description:** Daily cron job running at 00:00 UTC (midnight) that scans upcoming subscription renewals and generates pending reminder delivery records.

---

## 1. Overview & Thresholds

This job ensures upcoming renewal events have corresponding reminder schedule rows created in advance.

### Default Alert Thresholds
- **Warning (`P1` page):** 1 consecutive execution failure.
- **Critical (`P1` page):** 2 consecutive execution failures OR 5 failures in 1 hour.

Thresholds can be overridden via environment variables:
- `JOB_ALERT_REMINDER_SCHEDULING_CONSECUTIVE_FAILURES_WARNING`
- `JOB_ALERT_REMINDER_SCHEDULING_CONSECUTIVE_FAILURES_CRITICAL`
- `JOB_ALERT_REMINDER_SCHEDULING_FAILURES_PER_HOUR_CRITICAL`

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** Reminders are not scheduled for future subscription renewal dates. If unaddressed before 09:00 UTC, `reminder-processing` will have 0 items to send.
- **Sentry Alert Tags:**
  - `alert_type: job_failure`
  - `job_id: reminder-scheduling`
  - `paging_severity: page`
- **Log Pattern:**
  - `Background job failure recorded` with `jobId: reminder-scheduling`
  - `Error scheduling upcoming subscription reminders`

---

## 3. Diagnosis

### Step 1: Verify Scheduler Execution Status
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/admin/health
```
Ensure scheduler service status is `healthy`.

### Step 2: Compare Processed vs Pending Counts
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/admin/metrics/ops-summary
```
Verify whether `activity.pending_reminders` is 0 when active subscriptions with upcoming `next_billing_date` exist.

### Step 3: Inspect Database & Logs
1. Check logs for `Running scheduled reminder scheduling`.
2. Inspect Supabase database query failures for table `reminder_schedules` or `subscriptions`.
3. Check for timezone/date computation exceptions around UTC midnight boundaries.

---

## 4. Remediation

### Action 1: Resolve Database / Application Errors
- If database pooler timed out or schema lock occurred, resolve lock and restart backend process.

### Action 2: Trigger Manual Reminder Scheduling
Run manual scheduling scan via backend API (or node evaluation script if API endpoint not exposed):

```bash
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/reminders/schedule
```

### Action 3: Verify Scheduling Outcome
Query pending reminders metric to confirm reminder records were generated for upcoming renewal dates:

```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/admin/metrics/ops-summary
```
Confirm `pending_reminders` > 0.
