# Alert Runbook: Notification Queue Worker (`notification-queue`)

> **Alert Class:** `notification-queue`  
> **Paging Severity:** `page` (P1 On-Call)  
> **Job Description:** BullMQ asynchronous queue worker processing background push notifications, WebPush payloads, and SMS delivery jobs.

---

## 1. Overview & Thresholds

This BullMQ worker consumes push notification jobs from Redis queues and dispatches them asynchronously to end-user devices.

### Default Alert Thresholds
- **Warning (`P1` page):** 20 failures/hr OR 5 DLQ items in 24 hours.
- **Critical (`P1` page):** 50 failures/hr OR 15 DLQ items in 24 hours.

Thresholds can be overridden via environment variables:
- `JOB_ALERT_NOTIFICATION_QUEUE_FAILURES_PER_HOUR_WARNING`
- `JOB_ALERT_NOTIFICATION_QUEUE_FAILURES_PER_HOUR_CRITICAL`
- `JOB_ALERT_NOTIFICATION_QUEUE_DLQ_COUNT_24H_WARNING`
- `JOB_ALERT_NOTIFICATION_QUEUE_DLQ_COUNT_24H_CRITICAL`

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** Push/SMS notifications stall in queue, resulting in delayed or lost real-time alerts.
- **Sentry Alert Tags:**
  - `alert_type: job_failure`
  - `job_id: notification-queue`
  - `paging_severity: page`
- **Log Pattern:**
  - `Notification job failed`
  - `Redis connection lost in BullMQ worker`
  - `Dead-letter entry created in notification_dead_letter_queue`

---

## 3. Diagnosis

### Step 1: Check Redis Health & Queue Metrics
Verify Redis connectivity and check queue status:
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/admin/queues
```

### Step 2: Inspect Notification Dead-Letter Queue
```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/notifications/dead-letter/stats
```

### Step 3: Identify Failure Causes
1. **Redis Connectivity Failure:** `ECONNREFUSED` or Redis memory limit reached (`OOM command not allowed`).
2. **Payload Validation Error:** Invalid WebPush subscriptions or missing device token parameters.
3. **External Gateway Outage:** Google FCM, Apple APNs, or WebPush service returning HTTP 5xx errors.

---

## 4. Remediation

### Action 1: Restore Redis & Worker Process
- Restore Redis instance availability or flush expired cache keys.
- Restart backend node process if BullMQ worker event loops crashed.

### Action 2: Replay Individual Dead-Letter Queue Item
```bash
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/notifications/dead-letter/:dlqId/replay
```

### Action 3: Purge Stale / Unrecoverable Dead-Letter Items
```bash
curl -X DELETE -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/notifications/dead-letter/stale
```
See [DEAD_LETTER_HANDLING.md](../../backend/docs/DEAD_LETTER_HANDLING.md) for full DLQ management procedures.
