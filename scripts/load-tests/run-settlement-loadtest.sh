#!/usr/bin/env bash
# Load / stress helper for settlement batch sizing (no live chain required).
# Runs the Jest load-style suite that asserts maxBatchSize / backpressure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/backend"
echo "Running settlement batcher load-style tests..."
npx jest tests/settlement-batcher.test.ts --testNamePattern='load:' --forceExit
echo "Done. Tune SETTLEMENT_MAX_BATCH / SETTLEMENT_MAX_QUEUE_DEPTH / SETTLEMENT_MAX_IN_FLIGHT as needed."
