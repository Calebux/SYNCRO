# Alert Runbook: Webhook Retry Processing (`webhook-retries`)

> **Alert Class:** `webhook-retries`  
> **Paging Severity:** `alert` (P2 Incident)  
> **Job Description:** Every-5-minute cron job that retries failed outbound webhook deliveries to partner integrations and merchant endpoints.

---

## 1. Overview & Thresholds

This job processes retryable failed outbound webhooks, attempting re-delivery with backoff until success or dead-letter threshold is breached (`is_dead_letter = true`).

### Default Alert Thresholds
- **Warning (`P2` ticket):** 3 consecutive failures OR 10 DLQ items in 24 hours.
- **Critical (`P2` ticket):** 5 consecutive failures OR 25 DLQ items in 24 hours.

Thresholds can be overridden via environment variables:
- `JOB_ALERT_WEBHOOK_RETRIES_CONSECUTIVE_FAILURES_WARNING`
- `JOB_ALERT_WEBHOOK_RETRIES_CONSECUTIVE_FAILURES_CRITICAL`
- `JOB_ALERT_WEBHOOK_RETRIES_DLQ_COUNT_24H_WARNING`
- `JOB_ALERT_WEBHOOK_RETRIES_DLQ_COUNT_24H_CRITICAL`

---

## 2. Symptom

### Indicators & User Impact
- **User Impact:** Partner systems and external integrations miss event notifications (such as renewal events, status changes, or payment confirmations).
- **Sentry Alert Tags:**
  - `alert_type: job_failure`
  - `job_id: webhook-retries`
  - `paging_severity: alert`
- **Log Pattern:**
  - `Background job failure recorded` with `jobId: webhook-retries`
  - `Error retrying failed webhook deliveries`

---

## 3. Diagnosis

### Step 1: Check Dead-Letter Webhooks
Query dead-letter webhook deliveries from `webhook_deliveries`:
```sql
SELECT id, target_url, response_code, last_error_message, attempts
FROM webhook_deliveries
WHERE is_dead_letter = true AND dead_letter_at >= NOW() - INTERVAL '24 hours';
```

### Step 2: Group Failures by Target URL & Response Code
- **4xx Client Errors:** Target endpoint returning `404 Not Found`, `401 Unauthorized`, or `400 Bad Request`. (Endpoint configuration issue on partner side).
- **5xx Server Errors / Timeouts:** Target server experiencing outage or socket timeouts (`ETIMEDOUT`).

---

## 4. Remediation

### Action 1: Address Endpoint Outages or Configuration
- Contact partner if partner server is returning persistent errors.
- Disable or mark unparseable webhook subscriptions if endpoint has been permanently shut down.

### Action 2: Trigger Webhook Replay
Replay failed dead-letter webhooks via admin API:
```bash
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://api.example.com/api/admin/webhooks/replay-failed
```

### Action 3: Verify Delivery Metrics
Check that webhook DLQ count in the last 24 hours is below alert thresholds.
