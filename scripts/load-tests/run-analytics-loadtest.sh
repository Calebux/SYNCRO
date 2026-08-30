#!/usr/bin/env bash
set -euo pipefail

# Usage: X_API_KEY must be set in env (or use TARGET to point to server).
BASE=${TARGET:-http://localhost:3001}
DURATION=${DURATION:-30}
CONCURRENCY=${CONCURRENCY:-50}
PIPES=${PIPES:-10}
API_KEY=${X_API_KEY:-}

if [ -z "$API_KEY" ]; then
  echo "ERROR: X_API_KEY environment variable is required to authenticate analytics endpoints."
  echo "Set X_API_KEY and retry. Example: X_API_KEY=xxx ./run-analytics-loadtest.sh"
  exit 1
fi

echo "Running analytics summary load test against $BASE/api/analytics/summary"
npx autocannon -c $CONCURRENCY -d ${DURATION} -p $PIPES -H "x-api-key: $API_KEY" $BASE/api/analytics/summary

echo "Running analytics spending load test against $BASE/api/analytics/spending"
npx autocannon -c $CONCURRENCY -d ${DURATION} -p $PIPES -H "x-api-key: $API_KEY" $BASE/api/analytics/spending

echo "Load tests completed"
