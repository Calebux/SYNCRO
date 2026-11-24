#!/usr/bin/env bash
# sdk/scripts/run-integration.sh
#
# Stand up a local Soroban sandbox, deploy the contracts, and run the SDK
# integration suite.  This is the single documented command for local use:
#
#   npm run test:integration -w sdk
#
# Requirements:
#   - Docker (for the sandbox)
#   - Rust + cargo + wasm32-unknown-unknown target (for contract builds)
#   - Node 20+ with npm
#   - stellar CLI:  cargo install --locked stellar-cli --features opt
#
# Issue #1304 — single-command local integration run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SDK_ROOT="$REPO_ROOT/sdk"
CONTRACTS_ROOT="$REPO_ROOT/contracts"

# ─────────────────────────────────────────────────────────────────────────────
# Defaults (can be overridden by env)
# ─────────────────────────────────────────────────────────────────────────────
SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-http://localhost:8000/soroban/rpc}"
SOROBAN_NETWORK_PASSPHRASE="${SOROBAN_NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
STELLAR_CLI="${STELLAR_CLI:-stellar}"
DOCKER_IMAGE="${DOCKER_IMAGE:-stellar/quickstart:latest}"
SANDBOX_CONTAINER="${SANDBOX_CONTAINER:-syncro-soroban-sandbox}"
INTEGRATION_API_KEY="${INTEGRATION_API_KEY:-integration-test-key}"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
log()  { echo "[integration] $*"; }
fail() { echo "[integration] ERROR: $*" >&2; exit 1; }

check_dependency() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' not found. $2"
}

wait_for_rpc() {
  local url="$1"
  local max_attempts=30
  local attempt=0
  log "Waiting for Soroban RPC at $url …"
  until curl -sf -X POST "$url" \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":{}}' \
       | grep -q '"healthy"'; do
    attempt=$((attempt + 1))
    [[ $attempt -ge $max_attempts ]] && fail "RPC did not become healthy in time"
    sleep 2
  done
  log "Soroban RPC is up."
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Pre-flight checks
# ─────────────────────────────────────────────────────────────────────────────
check_dependency docker "Install Docker from https://docs.docker.com/get-docker/"
check_dependency "$STELLAR_CLI" "Run: cargo install --locked stellar-cli --features opt"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Start the Soroban sandbox (Docker quickstart node)
# ─────────────────────────────────────────────────────────────────────────────
log "Starting Soroban sandbox container: $SANDBOX_CONTAINER"

# Stop any leftover container from a previous run
docker rm -f "$SANDBOX_CONTAINER" 2>/dev/null || true

docker run -d \
  --name "$SANDBOX_CONTAINER" \
  -p 8000:8000 \
  --env ENABLE_SOROBAN_RPC=true \
  "$DOCKER_IMAGE" \
  --standalone \
  --enable-soroban-rpc 2>/dev/null || {
    # Docker quickstart v0.7+ uses a different entrypoint
    docker run -d \
      --name "$SANDBOX_CONTAINER" \
      -p 8000:8000 \
      "$DOCKER_IMAGE" \
      /start standalone
  }

# Register a cleanup trap so the container is always removed
cleanup() {
  log "Stopping sandbox container …"
  docker rm -f "$SANDBOX_CONTAINER" 2>/dev/null || true
}
trap cleanup EXIT

wait_for_rpc "$SOROBAN_RPC_URL"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Generate a funded test keypair
# ─────────────────────────────────────────────────────────────────────────────
log "Generating funded test keypair …"
AGENT_SECRET=$(
  "$STELLAR_CLI" keys generate integration-agent --no-fund 2>/dev/null
  "$STELLAR_CLI" keys show integration-agent 2>/dev/null | grep "Secret Key" | awk '{print $NF}' \
    || "$STELLAR_CLI" keys show integration-agent --secret-key 2>/dev/null
)

# Fund via Friendbot
AGENT_PUBLIC=$(
  "$STELLAR_CLI" keys show integration-agent --public-key 2>/dev/null \
    || "$STELLAR_CLI" keys show integration-agent 2>/dev/null | grep "Public Key" | awk '{print $NF}'
)
log "Funding $AGENT_PUBLIC via Friendbot …"
curl -sf "http://localhost:8000/friendbot?addr=$AGENT_PUBLIC" >/dev/null \
  || curl -sf "http://localhost:8000/friendbot?addr=$AGENT_PUBLIC&amount=10000" >/dev/null \
  || log "Friendbot unavailable — assuming account is already funded"

export INTEGRATION_AGENT_SECRET="$AGENT_SECRET"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Build contracts
# ─────────────────────────────────────────────────────────────────────────────
log "Building Soroban contracts …"
(
  cd "$CONTRACTS_ROOT"
  cargo build --target wasm32-unknown-unknown --release --quiet
)

# ─────────────────────────────────────────────────────────────────────────────
# 5. Deploy contracts and capture IDs
# ─────────────────────────────────────────────────────────────────────────────
WASM_DIR="$CONTRACTS_ROOT/target/wasm32-unknown-unknown/release"

deploy_contract() {
  local wasm_glob="$1"
  local wasm_file
  wasm_file="$(ls $WASM_DIR/${wasm_glob}*.wasm 2>/dev/null | head -1)"
  [[ -z "$wasm_file" ]] && fail "WASM not found: $wasm_glob in $WASM_DIR"

  "$STELLAR_CLI" contract deploy \
    --wasm "$wasm_file" \
    --source-account integration-agent \
    --rpc-url "$SOROBAN_RPC_URL" \
    --network-passphrase "$SOROBAN_NETWORK_PASSPHRASE" \
    2>&1 | tail -1
}

log "Deploying SubscriptionRegistry …"
export CONTRACT_SUBSCRIPTION_REGISTRY=$(deploy_contract "subscription_registry")
log "  → $CONTRACT_SUBSCRIPTION_REGISTRY"

log "Deploying SubscriptionRenewal …"
export CONTRACT_SUBSCRIPTION_RENEWAL=$(deploy_contract "subscription_renewal")
log "  → $CONTRACT_SUBSCRIPTION_RENEWAL"

log "Deploying SubscriptionLogging …"
export CONTRACT_SUBSCRIPTION_LOGGING=$(deploy_contract "subscription_logging")
log "  → $CONTRACT_SUBSCRIPTION_LOGGING"

export SOROBAN_RPC_URL
export SOROBAN_NETWORK_PASSPHRASE

# ─────────────────────────────────────────────────────────────────────────────
# 6. Regenerate SDK bindings from WASM (ensuring suite detects drift)
# ─────────────────────────────────────────────────────────────────────────────
log "Regenerating SDK bindings from WASM …"
node "$SDK_ROOT/scripts/generate-contract-bindings.cjs" \
  --wasm-dir "$WASM_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# 7. Run the integration suite
# ─────────────────────────────────────────────────────────────────────────────
log "Running SDK integration tests …"
(
  cd "$SDK_ROOT"
  npx jest \
    --testPathPattern="tests/integration" \
    --forceExit \
    --passWithNoTests \
    --ci="${CI:-false}"
)

log "Integration suite complete."
