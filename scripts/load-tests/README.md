Load tests for the backend reminder engine, analytics endpoints, and settlement batcher

Overview
- Lightweight shell scripts use `npx autocannon` (or Jest for settlement) to drive load.
- Scripts do not add dependencies to the repo; they rely on `npx` / existing Jest.

Files
- `run-reminder-loadtest.sh` — public status check + admin-trigger (`POST /api/reminders/process`). Requires `ADMIN_API_KEY` env var.
- `run-analytics-loadtest.sh` — authenticated analytics endpoints (`/api/analytics/summary` and `/api/analytics/spending`). Requires `X_API_KEY` env var.
- `seed-100k-subscriptions.sh` — generates N=100k subscriptions in Supabase for load testing the reminder + renewal jobs. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `PGSQL_CONN` for fast direct inserts).

Representative scenarios
1. Light (smoke): `DURATION=10 CONCURRENCY=10 ./run-analytics-loadtest.sh`
2. Medium (normal load): `DURATION=30 CONCURRENCY=50 ./run-analytics-loadtest.sh`
3. Heavy (stress): `DURATION=60 CONCURRENCY=200 ./run-analytics-loadtest.sh`

Example commands
Export required keys and run a medium analytics load test:

```bash
export X_API_KEY="your-test-api-key"
export TARGET="http://localhost:3001"
DURATION=30 CONCURRENCY=50 PIPES=10 ./scripts/load-tests/run-analytics-loadtest.sh
```

Run reminder engine tests (requires admin key):

```bash
export ADMIN_API_KEY="your-admin-key"
export TARGET="http://localhost:3001"
DURATION=30 CONCURRENCY=50 PIPES=10 ./scripts/load-tests/run-reminder-loadtest.sh
```

Measuring bottlenecks
- Fetch ops/monitoring metrics before and after a run (requires `ADMIN_API_KEY`):

```bash
curl -s -H "x-admin-api-key: $ADMIN_API_KEY" "$TARGET/api/admin/metrics/throughput?w=1" | jq .
curl -s -H "x-admin-api-key: $ADMIN_API_KEY" "$TARGET/api/admin/metrics/latency?w=1" | jq .
curl -s -H "x-admin-api-key: $ADMIN_API_KEY" "$TARGET/api/admin/metrics/retries?w=1" | jq .
curl -s -H "x-admin-api-key: $ADMIN_API_KEY" "$TARGET/api/admin/health" | jq .
```

- Use database query plans for slow queries: backend has `scripts/capture-query-plans.js` and `scripts/benchmark-performance-indexes.js` to capture plans and run benchmarks.
- Enable Sentry profiling or sampling during a controlled run to capture CPU/stack traces (Sentry is configured in `backend/src/index.ts`).

Interpreting results and next steps
- Look for increased 5xx responses, long tail latency, DB connection pool exhaustion, and retry queue growth.
- If DB is the bottleneck, enable or tune the indexes found in `backend/migrations/20260527000000_add_performance_indexes.sql` and re-run benchmarks.
- If CPU/GC is the bottleneck, consider scaling worker processes, optimizing heavy queries, or offloading analytics to materialized views.

## k6 Scenarios (CI-integrated)

Two k6 scripts in `tests/load-testing/` add multi-scenario coverage for the reminder and renewal orchestrator jobs under N=100k subscriptions:

### `load-test-reminders.js`
| Scenario | Executor | VUs | Duration | Description |
|---|---|---|---|---|
| `reminder_schedule` | per-vu-iterations | 10 | 20 iterations (max 5m) | POST /api/reminders/schedule — simulates daily scheduling job |
| `reminder_process` | ramping-vus | 0→5→20→0 | 2m | POST /api/reminders/process — processes pending reminders |
| `reminder_retry` | constant-vus | 5 | 2m | POST /api/reminders/retry — retries failed deliveries |
| `reminder_status` | constant-vus | 50 | 3m | GET /api/reminders/status — scheduler health check |

**Thresholds:** p(95)<10s for mutations, p(95)<500ms for status reads, error rate < 10%

### `load-test-renewals.js`
| Scenario | Executor | VUs | Duration | Description |
|---|---|---|---|---|
| `renewal_execution` | per-vu-iterations | 20 | 100 iters (max 10m) | POST /api/subscriptions/:id/renew — idempotent renewal w/ Redis locks |
| `dead_letter_query` | constant-vus | 10 | 3m | GET /api/renewals/dead-letter/stats — DLQ statistics |
| `renewal_metrics` | ramping-vus | 0→5→30→0 | 2m | GET /api/admin/metrics/renewals — admin renewal metrics |

**Thresholds:** p(95)<5s for renewals, p(95)<1s for reads, error rate < 10%

### Running locally
```bash
# Seed data (required first)
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
bash scripts/load-tests/seed-100k-subscriptions.sh

# Install k6 (https://k6.io/docs/getting-started/installation/)
k6 run tests/load-testing/load-test-reminders.js --env ADMIN_API_KEY=xxx --env SCENARIO=process
k6 run tests/load-testing/load-test-renewals.js --env ADMIN_API_KEY=xxx --env SCENARIO=renewal_execution
```

### CI Integration
The nightly workflow (`.github/workflows/load-test-nightly.yml`) runs all scenarios via cron at 02:00 UTC, collects summary-export JSON artifacts, and publishes a job summary with p95 latencies.
