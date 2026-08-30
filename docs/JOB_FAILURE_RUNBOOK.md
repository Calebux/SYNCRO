# Job Failure Runbook

> **Issue #100 · Area: ops · Priority: P1**  
> Operator response guide for critical background job failures. Threshold definitions live in `backend/src/config/job-alert-config.ts`.

## Table of Contents

1. [Alert Severity and Paging](#alert-severity-and-paging)
2. [Threshold Reference](#threshold-reference)
3. [Initial Response](#initial-response)
4. [Job Runbooks](#job-runbooks)
5. [Rollback Procedures](#rollback-procedures)
6. [Post-Incident Follow-Up](#post-incident-follow-up)

---

## Alert Severity and Paging

Sentry alerts carry a `paging_severity` tag that determines on-call response:

| Paging Severity | Priority | Response Expectation |
|-----------------|----------|----------------------|
| `page` | P1 | Page on-call immediately; begin diagnosis within 15 minutes |
| `alert` | P2 | Create incident ticket; respond within business hours (or 1 hour if user-facing) |
| `warn` | P3 | Monitor in Sentry; no page; triage during next business day |

Alert levels (`warning` vs `critical`) indicate how far a metric has breached its threshold. A **critical** breach on a `page`-severity job should be treated as a production incident.

---

## Threshold Reference

Critical jobs and default thresholds (override via `JOB_ALERT_<ENV_PREFIX>_*` env vars — see `job-alert-config.ts`):

| Job ID | Paging | Warning | Critical | Dedicated Runbook |
|--------|--------|---------|----------|-------------------|
| `reminder-processing` | page | 1 consecutive failure, 5 failures/hr | 2 consecutive, 15 failures/hr, 10 DLQ/24h | [reminder-processing-runbook.md](./ops/reminder-processing-runbook.md) |
| `reminder-scheduling` | page | 1 consecutive failure | 2 consecutive, 5 failures/hr | [reminder-scheduling-runbook.md](./ops/reminder-scheduling-runbook.md) |
| `reminder-retries` | page | 2 consecutive, 10 failures/hr, 10 DLQ/24h | 3 consecutive, 25 failures/hr, 50 DLQ/24h | [reminder-retries-runbook.md](./ops/reminder-retries-runbook.md) |
| `notification-queue` | page | 20 failures/hr, 5 DLQ/24h | 50 failures/hr, 15 DLQ/24h | [notification-queue-runbook.md](./ops/notification-queue-runbook.md) |
| `event-listener` | page | 5 consecutive, 10 failures/hr | 10 consecutive, 30 failures/hr | [event-listener-runbook.md](./ops/event-listener-runbook.md) |
| `expiry-processing` | alert | 1 consecutive failure | 2 consecutive, 3 failures/hr | [expiry-processing-runbook.md](./ops/expiry-processing-runbook.md) |
| `auto-resume` | alert | 1 consecutive, 3 failures/hr | 2 consecutive, 10 failures/hr | [auto-resume-runbook.md](./ops/auto-resume-runbook.md) |
| `webhook-retries` | alert | 3 consecutive, 10 DLQ/24h | 5 consecutive, 25 DLQ/24h | [webhook-retries-runbook.md](./ops/webhook-retries-runbook.md) |
| `csp-monitoring` | warn | 2 consecutive failures | 4 consecutive, 3 failures/hr | [csp-monitoring-runbook.md](./ops/csp-monitoring-runbook.md) |

**Useful diagnostic endpoints** (require `x-admin-api-key`):

```bash
# Overall health and active alerts
curl -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/admin/health

# Ops metrics summary
curl -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/admin/metrics/ops-summary

# Failed items drill-down
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  "https://api.example.com/api/admin/metrics/failed-items?type=reminder&limit=20"
```

See also [OPS_DASHBOARD_README.md](../backend/OPS_DASHBOARD_README.md) for metric baselines.

---

## Initial Response

### Step 1 — Acknowledge (< 5 minutes)

1. Acknowledge the Sentry alert to stop duplicate notifications.
2. Note the `job_id`, `alert_level`, and `paging_severity` tags.
3. Open the runbook section matching `runbook_section` in the Sentry context.

### Step 2 — Assess blast radius (< 10 minutes)

| Symptom | Likely user impact |
|---------|-------------------|
| Reminder/notification jobs failing | Users miss renewal reminders |
| Event listener failing | Blockchain state drift; renewals may not sync on-chain |
| Expiry/auto-resume failing | Subscriptions stay paused or active past intended dates |
| Webhook retries failing | Partner integrations miss events |
| CSP monitoring failing | Security violation detection delayed (no direct user impact) |

### Step 3 — Check scheduler health

```bash
curl https://api.example.com/api/reminders/status
# Expect: { "running": true, "jobCount": > 0 }
```

If `running: false`, restart the backend process — cron jobs register on boot via `SchedulerService`.

---

## Job Runbooks

### reminder-processing {#reminder-processing}

**What it does:** Delivers pending subscription reminders (email, push, Telegram) daily at 09:00 UTC.

**Diagnosis:**

1. Check failed deliveries: `GET /api/admin/metrics/failed-items?type=reminder`
2. Review `success_rate` in `GET /api/admin/metrics/renewals`
3. Check `pending_reminders` in `GET /api/admin/metrics/activity`
4. Inspect logs for `cron:process-reminders` or `Running scheduled reminder processing`

**Common causes:**

| Error pattern | Cause | Fix |
|---------------|-------|-----|
| SMTP connection errors | Email provider outage or bad credentials | Verify `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` |
| Push 410/404 | Stale device tokens | Self-healing; monitor DLQ count |
| High pending count | Scheduler not running | Restart backend; trigger manual process |

**Recovery:**

```bash
# Manual catch-up
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/reminders/process

# Flush retry queue
curl -X POST -H "x-admin-api-key: $ADMIN_API_KEY" https://api.example.com/api/reminders/retry
```

---

### reminder-scheduling {#reminder-scheduling}

**What it does:** Creates reminder schedules for upcoming billing dates (midnight UTC daily).

**Diagnosis:**

1. Compare `throughput.reminders_processed` vs `activity.pending_reminders`
2. Check logs for `Running scheduled reminder scheduling`
3. Verify Supabase connectivity (scheduling writes to `reminder_schedules`)

**Recovery:** Restart backend if cron stalled. No manual API — scheduling runs on next midnight UTC tick after recovery.

---

### reminder-retries {#reminder-retries}

**What it does:** Retries failed notification deliveries every 30 minutes.

**Diagnosis:**

1. Check `retries.max_retries_hit` in ops-summary
2. Pull failed items: `?type=reminder&limit=100`, group by `error_message`
3. Check notification DLQ: `GET /api/notifications/dead-letter/stats` (authenticated user scope) or admin failed-items

**Recovery:** Fix root cause (usually SMTP/push provider), then `POST /api/reminders/retry`.

---

### notification-queue {#notification-queue}

**What it does:** BullMQ worker delivering push notifications asynchronously.

**Diagnosis:**

1. Verify Redis: `REDIS_URL` reachable
2. Check DLQ growth: notification dead-letter stats
3. Review Sentry for `Notification job failed` log entries
4. Confirm worker process is running (same backend instance)

**Recovery:**

1. Restore Redis connectivity if down
2. Replay DLQ entries via `POST /api/notifications/dead-letter/:dlqId/replay`
3. See [DEAD_LETTER_HANDLING.md](../backend/docs/DEAD_LETTER_HANDLING.md)

---

### event-listener {#event-listener}

**What it does:** Polls Soroban contract events for renewal and lifecycle sync.

**Diagnosis:**

1. `GET /api/admin/health` → `eventListener.status` and `eventListener.reason`
2. Verify `STELLAR_NETWORK_URL` and `SOROBAN_CONTRACT_ADDRESS`
3. Check `activity.failed_blockchain_events`
4. Pull `?type=blockchain` failed items

**Recovery:**

1. Restore Soroban RPC connectivity
2. Event listener auto-recovers with exponential backoff after RPC restoration
3. Re-sync stale subscriptions: `POST /api/subscriptions/:id/retry-sync`

---

### expiry-processing {#expiry-processing}

**What it does:** Marks expired subscriptions daily at 02:00 UTC.

**Diagnosis:**

1. Check logs for `Running scheduled expiry processing`
2. Query subscriptions with `status = 'active'` past `next_billing_date`
3. Verify Supabase write access

**Recovery:** Restart backend; expiry runs on next 02:00 UTC cycle. For urgent cases, trigger expiry manually via admin tooling if available.

---

### auto-resume {#auto-resume}

**What it does:** Resumes paused subscriptions whose `resume_at` date has passed (06:00 UTC daily).

**Diagnosis:**

1. Query `subscriptions` where `status = 'paused'` and `resume_at <= now()`
2. Check logs for `[auto-resume]` entries
3. Individual subscription failures are logged but non-fatal

**Recovery:** Fix underlying `subscriptionService.resumeSubscription` errors; manually resume affected subscriptions via admin/API if time-sensitive.

---

### webhook-retries {#webhook-retries}

**What it does:** Retries failed outbound webhook deliveries every 5 minutes.

**Diagnosis:**

1. Check webhook DLQ stats via user-scoped API or `webhook_deliveries` where `is_dead_letter = true`
2. Group failures by `response_code` and `last_error_message`
3. See [DEAD_LETTER_HANDLING.md](../backend/docs/DEAD_LETTER_HANDLING.md)

**Recovery:** Fix partner endpoint or network issue; replay via dead-letter replay API.

---

### csp-monitoring {#csp-monitoring}

**What it does:** Refreshes CSP violation stats and evaluates security alerts every 5 minutes.

**Diagnosis:**

1. Confirm `CSP_MONITORING_ENABLED !== 'false'`
2. Check logs for `CSP stats refresh job` / `CSP alert check job`
3. See [CSP_INCIDENT_RESPONSE.md](./CSP_INCIDENT_RESPONSE.md) for violation-specific response

**Recovery:** Restart backend; CSP jobs start via `startCspMonitoringJobs()`. Security alerting is delayed but not user-blocking.

---

## Rollback Procedures

Use these when a bad deploy or config change caused job failures.

### Rollback a backend deploy

1. Revert to the last known-good release in your deploy pipeline.
2. Confirm `SENTRY_RELEASE` matches the rolled-back version.
3. Restart the backend process.
4. Verify `GET /api/admin/health` returns `status: healthy`.
5. Trigger manual catch-up for reminder jobs if backlog exists (see above).

### Rollback environment variable changes

1. Restore previous values for affected vars (`SMTP_*`, `STELLAR_NETWORK_URL`, `REDIS_URL`, `JOB_ALERT_*`).
2. Restart backend — cron jobs and workers re-read env on boot.
3. Monitor Sentry for 30 minutes to confirm alerts clear.

### Rollback a database migration (last resort)

Only if a migration broke job-related tables:

1. Follow `npm run db:verify-rollback` procedures in repo scripts.
2. Coordinate with team lead — data loss risk.
3. Re-run health check and manual job triggers after rollback.

### Disable alerting temporarily (investigation only)

```bash
# Disable periodic alert evaluation (does NOT stop job execution)
JOB_ALERT_MONITOR_ENABLED=false
```

Do not leave disabled for more than one incident cycle. Document why in the incident ticket.

---

## Post-Incident Follow-Up

Complete these after the immediate incident is resolved.

### Within 24 hours

- [ ] Document the incident: timeline, root cause, jobs affected, user impact
- [ ] Update this runbook if new diagnosis or recovery steps were discovered
- [ ] Verify all Sentry job-failure alerts have cleared
- [ ] Confirm DLQ counts returned to baseline
- [ ] Notify stakeholders if P1 (`page`) severity with user-facing impact

### Within 1 week

- [ ] Conduct a brief post-incident review (15–30 min for P3, full review for P1)
- [ ] Identify what went well and what did not
- [ ] Review whether alert thresholds in `job-alert-config.ts` were appropriate (too noisy / too quiet)
- [ ] Open follow-up tickets for preventive fixes (monitoring gaps, missing retries, infra hardening)

### Within 2 weeks

- [ ] Implement agreed preventive measures
- [ ] Update `docs/SENTRY_ALERT_ROUTING.md` if routing rules changed
- [ ] Tune `JOB_ALERT_*` env overrides in staging/production if thresholds were adjusted

### Metrics to capture

| Metric | Target |
|--------|--------|
| Time to detect | ≤ 5 min (automated alert) |
| Time to acknowledge | ≤ 15 min for P1, ≤ 1 hr for P2 |
| Time to resolve | Job-specific; see OPS_DASHBOARD baselines |
| DLQ items replayed | 100% of user-impacting failures within 24 hr |
| Repeat incidents (same root cause) | 0 within 30 days |

---

## Related Documentation

- [backend/OPS_DASHBOARD_README.md](../backend/OPS_DASHBOARD_README.md) — metrics baselines and ops endpoints
- [docs/ops/GRAFANA_DASHBOARD.md](./ops/GRAFANA_DASHBOARD.md) — Grafana panels and core SLI Prometheus metrics (`/metrics`)
- [docs/SENTRY_ALERT_ROUTING.md](./SENTRY_ALERT_ROUTING.md) — Sentry tag routing for job alerts
- [backend/docs/DEAD_LETTER_HANDLING.md](../backend/docs/DEAD_LETTER_HANDLING.md) — DLQ inspection and replay
- [docs/CSP_INCIDENT_RESPONSE.md](./CSP_INCIDENT_RESPONSE.md) — CSP-specific incident response
