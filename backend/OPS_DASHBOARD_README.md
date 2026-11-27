# Async Ops Dashboard — Operations Reference

> **Issue #99 · Area: ops · Priority: P1**  
> This document covers all admin monitoring endpoints, expected metric baselines, how to drill into failed items, and on-call runbook actions.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Endpoints](#endpoints)
   - [Existing Endpoints](#existing-endpoints)
   - [New Endpoints (Issue #99)](#new-endpoints-issue-99)
4. [Metric Baselines](#metric-baselines)
5. [Drilling Into Failed Items](#drilling-into-failed-items)
6. [On-Call Runbook](#on-call-runbook)
7. [Job Failure Alerting (Issue #100)](#job-failure-alerting-issue-100)
8. [Architecture Notes](#architecture-notes)

---

## Overview

SYNCRO runs three key **async product systems**:

| System | Description | Key Tables |
|--------|-------------|------------|
| **ReminderEngine** | Schedules and delivers renewal/trial reminders via email, push, and Telegram. Retries on failure with exponential back-off. | `reminder_schedules`, `notification_deliveries` |
| **RenewalExecutor** | Executes subscription renewals against the Soroban blockchain contract. Supports up to 3 automatic retries. | `renewal_logs`, `renewal_approvals` |
| **SchedulerService** | 12 cron jobs that drive all async pipelines (daily reminders, retries every 30 min, webhook retries every 5 min, etc.) | N/A — orchestrates the above |

The ops dashboard exposes metrics for **throughput**, **latency**, **retry depth**, and **failed-item drill-down** across all three systems.

---

## Authentication

All admin endpoints require the `x-admin-api-key` HTTP header.

```http
GET /api/admin/metrics/throughput
x-admin-api-key: <ADMIN_API_KEY>
```

The key is set via the `ADMIN_API_KEY` environment variable (required in production). Requests without a valid key receive `401 Unauthorized`.

Rate limiting: all admin endpoints share a dedicated rate limiter (`createAdminLimiter()`).

---

## Endpoints

All endpoints accept an optional `?window=N` query parameter (1 ≤ N ≤ 720 hours, default 24) that controls the look-back window for time-series metrics.

### Existing Endpoints

#### `GET /api/admin/metrics/subscriptions`

Returns platform-wide subscription metrics.

```json
{
  "total_subscriptions": 1240,
  "active_subscriptions": 980,
  "category_distribution": {
    "entertainment": 420,
    "productivity": 310,
    "fitness": 250
  },
  "total_monthly_revenue": 14532.40
}
```

#### `GET /api/admin/metrics/renewals`

Returns notification delivery metrics for the last 24 hours.

```json
{
  "total_delivery_attempts": 380,
  "success_rate": 94.7,
  "failure_rate": 5.3,
  "channel_distribution": {
    "email":    { "success": 210, "failure": 12 },
    "push":     { "success": 120, "failure": 6 },
    "telegram": { "success": 30,  "failure": 2 }
  }
}
```

#### `GET /api/admin/metrics/activity`

Returns agent activity for the last 24 hours.

```json
{
  "pending_reminders": 15,
  "processed_reminders_last_24h": 340,
  "confirmed_blockchain_events": 120,
  "failed_blockchain_events": 3
}
```

#### `GET /api/admin/health`

Returns full system health including DB pool, event listener status, and historical snapshots.

---

### New Endpoints (Issue #99)

#### `GET /api/admin/metrics/throughput`

**Items processed per time window across all async pipelines.**

```
GET /api/admin/metrics/throughput?window=24
```

```json
{
  "window_hours": 24,
  "window_start": "2026-05-25T19:12:00.000Z",
  "reminders_processed": 340,
  "notification_deliveries_total": 380,
  "deliveries_by_channel": {
    "email": 222,
    "push": 126,
    "telegram": 32
  },
  "renewals_executed": 45,
  "renewals_by_status": {
    "success": 41,
    "failed": 4
  },
  "blockchain_events": 52
}
```

---

#### `GET /api/admin/metrics/latency`

**End-to-end processing latency percentiles for the notification and renewal pipelines.**

Latency is measured as:
- **Notification**: `last_attempt_at − created_at` on `notification_deliveries`
- **Renewal**: `updated_at − created_at` on `renewal_logs`

```
GET /api/admin/metrics/latency?window=24
```

```json
{
  "window_hours": 24,
  "window_start": "2026-05-25T19:12:00.000Z",
  "notification_delivery_latency": {
    "p50_ms": 120,
    "p95_ms": 480,
    "p99_ms": 1200,
    "avg_ms": 195,
    "sample_count": 380
  },
  "renewal_execution_latency": {
    "p50_ms": 820,
    "p95_ms": 3100,
    "p99_ms": 8500,
    "avg_ms": 1050,
    "sample_count": 45
  }
}
```

---

#### `GET /api/admin/metrics/retries`

**Retry depth across the notification delivery pipeline.**

```
GET /api/admin/metrics/retries?window=24
```

```json
{
  "window_hours": 24,
  "window_start": "2026-05-25T19:12:00.000Z",
  "total_retried": 22,
  "max_retries_hit": 5,
  "retry_rate_pct": 55.0,
  "attempt_distribution": {
    "1": 358,
    "2": 17,
    "3": 5
  },
  "retries_by_channel": {
    "email":    { "retried": 14, "max_hit": 3 },
    "push":     { "retried": 6,  "max_hit": 1 },
    "telegram": { "retried": 2,  "max_hit": 1 }
  }
}
```

---

#### `GET /api/admin/metrics/failed-items`

**Paginated list of failed items for operator drill-down.**

| Query Param | Required | Description |
|-------------|----------|-------------|
| `type` | ✅ | `reminder` \| `renewal` \| `blockchain` |
| `limit` | ❌ | Page size, max 100 (default 20) |
| `offset` | ❌ | Pagination offset (default 0) |

```
GET /api/admin/metrics/failed-items?type=reminder&limit=20&offset=0
```

```json
{
  "type": "reminder",
  "total": 12,
  "limit": 20,
  "offset": 0,
  "items": [
    {
      "id": "del-abc123",
      "type": "reminder",
      "status": "failed",
      "channel": "email",
      "attempt_count": 3,
      "error_message": "connect ECONNREFUSED smtp.provider.com:587",
      "subscription_id": "sub-xyz789",
      "user_id": "usr-001",
      "created_at": "2026-05-26T08:00:00Z",
      "updated_at": "2026-05-26T08:12:34Z"
    }
  ]
}
```

**`type=renewal`** example item:
```json
{
  "id": "rnw-def456",
  "type": "renewal",
  "status": "failed",
  "failure_reason": "contract_failure",
  "error_message": "Soroban RPC timeout after 30s",
  "subscription_id": "sub-xyz789",
  "user_id": "usr-001",
  "created_at": "2026-05-26T09:00:00Z",
  "updated_at": "2026-05-26T09:00:32Z"
}
```

**`type=blockchain`** example item:
```json
{
  "id": "bc-ghi789",
  "type": "blockchain",
  "status": "failed",
  "error_message": "Transaction submission rejected: insufficient fees",
  "subscription_id": "sub-abc001",
  "user_id": "usr-002",
  "created_at": "2026-05-26T10:00:00Z"
}
```

---

#### `GET /api/admin/metrics/ops-summary`

**Unified dashboard snapshot — all metric groups in a single response.**  
Ideal for dashboard polling and alerting pipelines.

```
GET /api/admin/metrics/ops-summary?window=24
```

```json
{
  "generated_at": "2026-05-26T19:12:42.000Z",
  "window_hours": 24,
  "subscriptions": { "..." : "..." },
  "renewals":      { "..." : "..." },
  "activity":      { "..." : "..." },
  "trials":        { "..." : "..." },
  "throughput":    { "..." : "..." },
  "latency":       { "..." : "..." },
  "retries":       { "..." : "..." },
  "db_pool": {
    "activeConnections": 2,
    "idleConnections": 8,
    "totalRequests": 15420,
    "leakWarnings": 0
  }
}
```

All sub-metric groups use the same `window` value.

---

## Metric Baselines

These are the expected healthy-state values operators should monitor against:

| Metric | Healthy Baseline | Warning Threshold | Critical Threshold |
|--------|-----------------|-------------------|--------------------|
| `renewals.success_rate` | ≥ 95% | < 95% | < 85% |
| `renewals.failure_rate` | ≤ 5% | > 5% | > 15% |
| `notification_delivery_latency.p95_ms` | < 5 000 ms | > 5 000 ms | > 15 000 ms |
| `notification_delivery_latency.p99_ms` | < 15 000 ms | > 15 000 ms | > 30 000 ms |
| `renewal_execution_latency.p95_ms` | < 10 000 ms | > 10 000 ms | > 30 000 ms |
| `retries.max_retries_hit` (per 24 h) | ≤ 10 | > 10 | > 50 |
| `retries.retry_rate_pct` | ≤ 20% | > 20% | > 50% |
| `activity.failed_blockchain_events` (per 24 h) | ≤ 5 | > 5 | > 20 |
| `activity.pending_reminders` | ≤ 50 | > 50 | > 200 |
| `throughput.reminders_processed` (per 24 h) | ≥ 10 when subscriptions exist | — | 0 when > 0 pending |
| `db_pool.leakWarnings` | 0 | > 0 | > 5 |

> **Note**: Baselines assume ~1 000 active subscriptions. Scale thresholds linearly for larger volumes.

---

## Drilling Into Failed Items

### Step 1 — Identify the failing pipeline

Check `GET /api/admin/metrics/ops-summary` or the individual metric endpoints:
- High `renewals.failure_rate` → use `?type=renewal`
- High `retries.max_retries_hit` → use `?type=reminder`
- High `activity.failed_blockchain_events` → use `?type=blockchain`

### Step 2 — Fetch the failed items

```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  "https://api.yourdomain.com/api/admin/metrics/failed-items?type=reminder&limit=20"
```

### Step 3 — Interpret `failure_reason` and `error_message`

| `failure_reason` | Likely Cause | Action |
|-----------------|--------------|--------|
| `contract_failure` | Soroban RPC error or network timeout | Check `STELLAR_NETWORK_URL` env; verify node health |
| `invalid_approval` | Approval record missing or expired | Confirm approval flow; check `renewal_approvals` table |
| `billing_window_invalid` | Subscription not active or billing date too far ahead | Check subscription status; verify cron schedule |
| `execution_error` | Unexpected exception in RenewalExecutor | Check server logs by `subscription_id` |
| *(SMTP errors)* | Email provider unreachable | Check SMTP credentials and provider status page |
| *(push 410/404)* | Stale push subscription token | Token is auto-cleaned; no action needed |
| `Network error` (blockchain) | Blockchain node unreachable | Check `STELLAR_NETWORK_URL`; verify Soroban node uptime |

### Step 4 — Trigger a retry

- **Notification retries**: `POST /api/reminders/retry` (admin-only) triggers `reminderEngine.processRetries()`.
- **Renewal retries**: Use `RenewalExecutor.executeRenewalWithRetry()` programmatically or re-queue from the admin panel.
- **Blockchain re-sync**: `POST /api/subscriptions/:id/retry-sync` (authenticated user endpoint).

---

## On-Call Runbook

### Scenario A: `success_rate` drops below 85%

1. Check `GET /api/admin/metrics/failed-items?type=reminder` for error patterns.
2. Look for SMTP or push provider errors — check provider status pages.
3. If SMTP: verify `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` env vars are set correctly.
4. Trigger `POST /api/reminders/retry` to flush the retry queue.
5. Monitor `success_rate` over the next 30 minutes.

### Scenario B: `renewal_execution_latency.p99_ms` > 30 000 ms

1. Check `GET /api/admin/metrics/failed-items?type=renewal` for `contract_failure` entries.
2. Verify Stellar/Soroban node health at `STELLAR_NETWORK_URL`.
3. Check `db_pool.leakWarnings` — a high value indicates a resource leak causing slowdowns.
4. Review server logs for timeout stack traces tagged with the affected `subscription_id`.

### Scenario C: `pending_reminders` > 200

1. Confirm the SchedulerService cron (`0 9 * * *`) is running: `GET /api/reminders/status`.
2. If `running: false`, restart the backend — the scheduler starts on boot.
3. Manually trigger `POST /api/reminders/process` to catch up immediately.
4. Monitor `activity.processed_reminders_last_24h` to confirm the backlog is clearing.

### Scenario D: `max_retries_hit` spike (> 50 in 24 h)

1. Pull `GET /api/admin/metrics/failed-items?type=reminder&limit=100`.
2. Group by `error_message` to find the dominant failure mode.
3. If push-related: stale tokens are auto-cleaned, spike is self-resolving.
4. If email-related: check SMTP provider — may need credential rotation.
5. Consider temporarily increasing `maxRetryAttempts` in `ReminderEngine` constructor if the underlying service is experiencing degraded availability.

### Scenario E: `failed_blockchain_events` > 20

1. Check blockchain node connectivity via `GET /api/admin/health` → `event_listener` field.
2. Pull `GET /api/admin/metrics/failed-items?type=blockchain` for error details.
3. If node is unreachable: engage infra team to restore Soroban RPC access.
4. Blockchain sync failures are non-blocking (DB operations succeed independently).
5. Retry stale syncs using `/api/subscriptions/:id/retry-sync` once connectivity is restored.

---

## Job Failure Alerting (Issue #100)

Critical background jobs have defined alert thresholds and paging severity in `backend/src/config/job-alert-config.ts`. When thresholds breach, the `JobAlertService` emits Sentry alerts tagged with `alert_type:job_failure`.

| Resource | Location |
|----------|----------|
| Threshold definitions | `backend/src/config/job-alert-config.ts` |
| Alert evaluation service | `backend/src/services/job-alert-service.ts` |
| Periodic monitor (5 min) | `backend/src/jobs/job-alert-monitor.ts` |
| Operator runbook | [docs/JOB_FAILURE_RUNBOOK.md](../docs/JOB_FAILURE_RUNBOOK.md) |

Disable the periodic monitor with `JOB_ALERT_MONITOR_ENABLED=false`. Override thresholds per job via `JOB_ALERT_<ENV_PREFIX>_*` env vars (documented in the config file).

---

## Architecture Notes

- All new metric queries use **covering indexes** added in migration `20260526000000_add_ops_metrics_indexes.sql` to avoid full-table scans.
- Latency is computed in-process from `created_at` / `last_attempt_at` / `updated_at` columns — no additional instrumentation tables are required.
- Failed-item drill-down queries return **no PII** (no email, wallet address, or payment data) — only IDs, error messages, and timestamps.
- All admin endpoints are protected by `adminAuth` middleware and `createAdminLimiter()` rate limiting.
- The `ops-summary` endpoint fires all sub-metric queries concurrently via `Promise.all` — typical response time is bounded by the slowest individual query.
