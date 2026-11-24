#!/bin/bash
set -e

NETWORK=${1:-testnet}
SECRET_KEY=${STELLAR_SECRET_KEY:?'STELLAR_SECRET_KEY required'}

# Derive the public key for use as admin
ADMIN_ADDRESS=$(stellar keys address "$SECRET_KEY" 2>/dev/null || \
  stellar account show --source "$SECRET_KEY" --network "$NETWORK" | grep "Public Key" | awk '{print $3}')

echo "==> Building contracts..."
cargo build --manifest-path "$(dirname "$0")/../Cargo.toml" \
  --target wasm32-unknown-unknown \
  --release \
  -p zk_payment_verifier \
  -p contract_upgrade

WASM_DIR="$(dirname "$0")/../target/wasm32-unknown-unknown/release"

echo ""
echo "==> Deploying to $NETWORK..."

# Deploy ZkPaymentVerifier
echo "  Deploying ZkPaymentVerifier..."
ZK_VERIFIER_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/zk_payment_verifier.wasm" \
  --source "$SECRET_KEY" \
  --network "$NETWORK")
echo "  ZkPaymentVerifier: $ZK_VERIFIER_ID"

# Deploy ContractUpgradeGovernance
echo "  Deploying ContractUpgradeGovernance..."
UPGRADE_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/contract_upgrade.wasm" \
  --source "$SECRET_KEY" \
  --network "$NETWORK")
echo "  ContractUpgradeGovernance: $UPGRADE_ID"

echo ""
echo "==> Add to backend/.env:"
echo "SOROBAN_ZK_VERIFIER_ADDRESS=$ZK_VERIFIER_ID"
echo "SOROBAN_UPGRADE_ADDRESS=$UPGRADE_ID"

# Write addresses to a local file for reference
OUTPUT_FILE="$(dirname "$0")/deployed-addresses-${NETWORK}.env"
cat > "$OUTPUT_FILE" <<EOF
# Deployed on $NETWORK — $(date -u +"%Y-%m-%dT%H:%M:%SZ")
SOROBAN_ZK_VERIFIER_ADDRESS=$ZK_VERIFIER_ID
SOROBAN_UPGRADE_ADDRESS=$UPGRADE_ID
EOF
echo ""
echo "Addresses saved to $OUTPUT_FILE"

# Generate deployment manifest JSON
echo ""
echo "==> Generating deployment manifest..."

# Get WASM hashes
ZK_VERIFIER_HASH=$(sha256sum "$WASM_DIR/zk_payment_verifier.wasm" | awk '{print $1}')
UPGRADE_HASH=$(sha256sum "$WASM_DIR/contract_upgrade.wasm" | awk '{print $1}')

# Get version from Cargo.toml
VERSION=$(grep '^version = ' "$(dirname "$0")/../Cargo.toml" | head -1 | sed 's/version = "\(.*\)"/\1/')

# Get commit SHA
COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

# Get current timestamp
DEPLOYED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Note: deployed_ledger would require querying the network, setting to null for now
MANIFEST_FILE="$(dirname "$0")/../../deployments/${NETWORK}.json"

cat > "$MANIFEST_FILE" <<EOF
{
  "network": "$NETWORK",
  "deployed_at": "$DEPLOYED_AT",
  "deployed_ledger": null,
  "deployer_address": "$ADMIN_ADDRESS",
  "commit_sha": "$COMMIT_SHA",
  "contracts": {
    "zk_payment_verifier": {
      "contract_id": "$ZK_VERIFIER_ID",
      "wasm_hash": "$ZK_VERIFIER_HASH",
      "version": "$VERSION"
    },
    "contract_upgrade": {
      "contract_id": "$UPGRADE_ID",
      "wasm_hash": "$UPGRADE_HASH",
      "version": "$VERSION"
    }
  }
}
EOF

echo "Deployment manifest saved to $MANIFEST_FILE"
echo ""
echo "Next steps:"
echo "  1. Commit the deployment manifest: git add deployments/${NETWORK}.json"
echo "  2. Backend can now load contract IDs from: deployments/${NETWORK}.json"
echo "  3. SDK can export deployment info for clients"
