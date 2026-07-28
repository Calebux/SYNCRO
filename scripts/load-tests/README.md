Load tests for the backend reminder engine, analytics endpoints, and settlement batcher

Overview
- Lightweight shell scripts use `npx autocannon` (or Jest for settlement) to drive load.
- Scripts do not add dependencies to the repo; they rely on `npx` / existing Jest.

Files
- `run-reminder-loadtest.sh` — public status check + admin-trigger (`POST /api/reminders/process`). Requires `ADMIN_API_KEY` env var.
- `run-analytics-loadtest.sh` — authenticated analytics endpoints (`/api/analytics/summary` and `/api/analytics/spending`). Requires `X_API_KEY` env var.
- `run-settlement-loadtest.sh` — bounded batch sizing / backpressure assertions via Jest (`settlement-batcher.test.ts`).

Settlement batch env knobs
- `SETTLEMENT_MIN_BATCH` (default 3)
- `SETTLEMENT_MAX_BATCH` (default 20) — hard cap per on-chain submit
- `SETTLEMENT_MAX_WAIT_MS` (default 300000)
- `SETTLEMENT_MAX_QUEUE_DEPTH` (default 500) — enqueue backpressure
- `SETTLEMENT_MAX_IN_FLIGHT` (default 2)

```bash
./scripts/load-tests/run-settlement-loadtest.sh
```

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
