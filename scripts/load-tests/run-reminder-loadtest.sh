#!/usr/bin/env bash
set -euo pipefail

# Usage: ADMIN_API_KEY must be set in env. Optional: TARGET, DURATION, CONCURRENCY, PIPES
BASE=${TARGET:-http://localhost:3001}
DURATION=${DURATION:-30}
CONCURRENCY=${CONCURRENCY:-50}
PIPES=${PIPES:-10}
ADMIN_KEY=${ADMIN_API_KEY:-}

if [ -z "$ADMIN_KEY" ]; then
  echo "ERROR: ADMIN_API_KEY environment variable is required to hit admin endpoints."
  echo "Set ADMIN_API_KEY and retry. Example: ADMIN_API_KEY=xxx ./run-reminder-loadtest.sh"
  exit 1
fi

echo "Running quick health/status test against $BASE/api/reminders/status"
npx autocannon -c $CONCURRENCY -d ${DURATION} -p $PIPES $BASE/api/reminders/status

echo "Running admin-trigger test against $BASE/api/reminders/process"
npx autocannon -c $CONCURRENCY -d ${DURATION} -p $PIPES -m POST -H "x-admin-api-key: $ADMIN_KEY" $BASE/api/reminders/process

echo "Load tests completed"
