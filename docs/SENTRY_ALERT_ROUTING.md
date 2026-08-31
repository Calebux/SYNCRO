# Sentry Alert Routing

This document describes the unified Sentry configuration shared by the **client** (Next.js) and **backend** (Express) stacks.

## Release naming

All events are tagged with a release string following the convention:

```
syncro@<package-version>+<short-git-sha>
```

Examples: `syncro@1.0.0+a3f9b21`, `syncro@0.1.0` (local dev, no SHA).

The release is resolved in this order:

1. `SENTRY_RELEASE` env var (set by CI / deploy pipeline).
2. Constructed from `npm_package_version` + `COMMIT_SHA` env var.

Both stacks use the same `resolveRelease()` helper from `shared/src/sentry.ts`.

## Environment tagging

| Environment value | When it applies |
|---|---|
| `production` | Production deploys |
| `staging` | Staging / preview deploys |
| `development` | Local development |
| `test` | Test suites |

Resolution order:

1. `SENTRY_ENVIRONMENT` env var (explicit override).
2. `NODE_ENV`.
3. Falls back to `development`.

## Service tag

Every event carries a `service` tag:

| Value | Source |
|---|---|
| `client` | Next.js client, server, and edge runtimes |
| `backend` | Express API server |

Use `service:client` or `service:backend` in Sentry alert filters to route issues to the correct team.

## Shared tag keys

Both stacks use the same tag key constants from `SENTRY_TAG_KEYS`:

| Tag key | Description |
|---|---|
| `service` | `client` or `backend` |
| `category` | Error taxonomy: `auth`, `database`, `network`, `validation`, `unknown` |
| `component` | React component or Express route |
| `csp_directive` | CSP directive involved in a violation report |
| `alert_type` | Alert category: `job_failure` for background job threshold breaches |
| `job_id` | Background job identifier (see `job-alert-config.ts`) |
| `paging_severity` | `page` (P1), `alert` (P2), or `warn` (P3) |

## Sensitive data redaction

A shared `beforeSend` hook (`scrubEvent`) runs on both stacks and redacts:

### Request headers
`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-forwarded-for`, `x-real-ip`

### Request cookies
Replaced entirely with `[Redacted]`.

### Body / extra fields
`password`, `new_password`, `confirm_password`, `token`, `access_token`, `refresh_token`, `secret`, `api_key`, `credit_card`, `card_number`, `cvv`, `ssn`, `mnemonic`, `stellar_secret_key`, `encryption_key` (and common casing variants).

### User context
Only `user.id` is preserved. Email, IP address, and other fields are stripped.

### Breadcrumbs
Breadcrumb `data` payloads are scrubbed with the same body-field rules.

## Sample rates

| Metric | Client (prod) | Client (dev) | Backend (prod) | Backend (dev) |
|---|---|---|---|---|
| Traces | 10% | 100% | 10% | 100% |
| Profiles | n/a | n/a | 10% | 10% |
| Replays (sessions) | 10% | 10% | n/a | n/a |
| Replays (on error) | 100% | 100% | n/a | n/a |

## Alert routing recommendations

### High-priority alerts (P1)
- **Unhandled exceptions** — both `service:client` and `service:backend`.
- **CSP violations with `csp_directive` tag** — spike detection on hourly rate.
- **`category:auth` errors** — potential credential or session issues.
- **Job failures (`alert_type:job_failure`)** — filter on `paging_severity:page` for P1 on-call. Critical jobs: reminder processing/scheduling/retries, notification queue, event listener. See [JOB_FAILURE_RUNBOOK.md](./JOB_FAILURE_RUNBOOK.md).

### Medium-priority alerts (P2)
- **`category:database` errors** — Supabase / Postgres issues.
- **`category:network` errors** — upstream API failures.
- **New issue in current release** — catch regressions early.
- **Job failures with `paging_severity:alert`** — expiry processing, auto-resume, webhook retries.

### Low-priority alerts (P3)
- **Job failures with `paging_severity:warn`** — CSP monitoring job health.

### Routing by team
- Filter on `service:client` to route to frontend team.
- Filter on `service:backend` to route to backend / infra team.
- CSP alerts (any service) go to security / infra.

## Environment variables

| Variable | Required | Where | Description |
|---|---|---|---|
| `SENTRY_DSN` | Yes (prod) | Backend | Sentry project DSN |
| `NEXT_PUBLIC_SENTRY_DSN` | Yes (prod) | Client | Sentry project DSN (public) |
| `SENTRY_RELEASE` | No | Both | Explicit release override |
| `SENTRY_ENVIRONMENT` | No | Both | Explicit environment override |
| `COMMIT_SHA` | No | Both | Git SHA for release tagging |
| `SENTRY_ORG` | No | Client build | Org slug for source map upload |
| `SENTRY_PROJECT` | No | Client build | Project slug for source map upload |
| `SENTRY_AUTH_TOKEN` | No | Client build | Auth token for source map upload |

## Configuration files

| File | Purpose |
|---|---|
| `shared/src/sentry.ts` | Shared release, environment, tag keys, and `scrubEvent` |
| `client/sentry.client.config.ts` | Browser-side Sentry init |
| `client/sentry.server.config.ts` | Next.js server-side Sentry init |
| `client/sentry.edge.config.ts` | Next.js edge runtime Sentry init |
| `backend/src/index.ts` | Express Sentry init (lines 13-27) |
| `backend/src/config/job-alert-config.ts` | Critical job alert thresholds and paging severity |
| `backend/src/jobs/job-alert-monitor.ts` | Periodic job failure threshold evaluation |
| `client/lib/telemetry.ts` | Client error/warning tracking helpers |
| `client/next.config.mjs` | `withSentryConfig` wrapper for source maps |
