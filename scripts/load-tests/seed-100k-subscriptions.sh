#!/usr/bin/env bash
set -euo pipefail

BATCH_SIZE=${BATCH_SIZE:-1000}
TOTAL=${TOTAL:-100000}
BASE_URL=${SUPABASE_URL:?SUPABASE_URL required}
SERVICE_KEY=${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}
PG_CONN=${PGSQL_CONN:-}

echo "=== Seed 100k Subscriptions for Load Testing ==="
echo "Target: $TOTAL subscriptions in batches of $BATCH_SIZE"

BATCHES=$((TOTAL / BATCH_SIZE))

insert_sql() {
  local start=$1
  local count=$2
  cat <<SQL
INSERT INTO subscriptions (id, user_id, name, status, category, amount, currency, billing_cycle, active_until, next_billing_date, created_at, updated_at)
SELECT
  'sub-' || LPAD(seq::text, 9, '0'),
  'loadtest-' || LPAD(seq::text, 6, '0'),
  'Load Test Subscription ' || seq,
  'active',
  'loadtest',
  9.99,
  'USD',
  'monthly',
  '2026-12-' || LPAD(MOD(seq, 28)::int + 1::text, 2, '0') || 'T00:00:00Z',
  '2026-08-' || LPAD(MOD(seq, 28)::int + 1::text, 2, '0') || 'T00:00:00Z',
  '2026-01-01T00:00:00Z',
  '2026-07-01T00:00:00Z'
FROM generate_series($start, $start + $count - 1) AS seq
ON CONFLICT (id) DO NOTHING;
SQL
}

echo "Generating and inserting subscriptions..."
if [ -n "$PG_CONN" ]; then
  for b in $(seq 0 $((BATCHES - 1))); do
    start=$((b * BATCH_SIZE + 1))
    echo "Batch $((b + 1))/$BATCHES (rows $start-$((start + BATCH_SIZE - 1)))"
    insert_sql $start $BATCH_SIZE | psql "$PG_CONN" -q
  done
else
  echo "Using REST API (slow — consider PGSQL_CONN for production scale)"
  AUTH="Authorization: Bearer $SERVICE_KEY"
  CONTENT="Content-Type: application/json"
  API="${BASE_URL}/rest/v1/subscriptions"

  for b in $(seq 0 $((BATCHES - 1))); do
    start=$((b * BATCH_SIZE + 1))
    echo "Batch $((b + 1))/$BATCHES (rows $start-$((start + BATCH_SIZE - 1)))"

    payload="["
    for i in $(seq $start $((start + BATCH_SIZE - 1))); do
      uid="loadtest-$(printf '%06d' $i)"
      sid="sub-$(printf '%09d' $i)"
      day=$(( (i % 28) + 1 ))
      [ "$i" -ne "$start" ] && payload+=","
      payload+="{\"id\":\"$sid\",\"user_id\":\"$uid\",\"name\":\"Load Test Subscription $i\",\"status\":\"active\",\"category\":\"loadtest\",\"amount\":9.99,\"currency\":\"USD\",\"billing_cycle\":\"monthly\",\"active_until\":\"2026-12-$(printf '%02d' $day)T00:00:00Z\",\"next_billing_date\":\"2026-08-$(printf '%02d' $day)T00:00:00Z\"}"
    done
    payload+="]"

    curl -s -X POST "$API" -H "$AUTH" -H "$CONTENT" -H "Prefer: resolution=merge-duplicates" -d "$payload" > /dev/null
    echo "  Inserted batch $((b + 1))"
  done
fi

echo ""
echo "=== Seeding complete: $TOTAL subscriptions ==="
echo "Next steps:"
echo "  k6 run tests/load-testing/load-test-reminders.js"
echo "  k6 run tests/load-testing/load-test-renewals.js"