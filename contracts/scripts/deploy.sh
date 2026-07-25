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
  -p subscription_registry \
  -p subscription_renewal \
  -p subscription_logging \
  -p zk_payment_verifier \
  -p contract_upgrade

WASM_DIR="$(dirname "$0")/../target/wasm32-unknown-unknown/release"

echo ""
echo "==> Deploying to $NETWORK..."

# Deploy SubscriptionRegistry
echo "  Deploying SubscriptionRegistry..."
REGISTRY_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/subscription_registry.wasm" \
  --source "$SECRET_KEY" \
  --network "$NETWORK")
echo "  SubscriptionRegistry: $REGISTRY_ID"

# Deploy SubscriptionRenewal
echo "  Deploying SubscriptionRenewal..."
RENEWAL_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/subscription_renewal.wasm" \
  --source "$SECRET_KEY" \
  --network "$NETWORK")
echo "  SubscriptionRenewal: $RENEWAL_ID"

# Deploy SubscriptionLogging
echo "  Deploying SubscriptionLogging..."
LOGGING_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/subscription_logging.wasm" \
  --source "$SECRET_KEY" \
  --network "$NETWORK")
echo "  SubscriptionLogging: $LOGGING_ID"

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
echo "==> Running initialization..."
bash "$(dirname "$0")/init.sh" "$NETWORK" "$SECRET_KEY" "$RENEWAL_ID" "$LOGGING_ID" "$UPGRADE_ID"

echo ""
echo "==> Add to backend/.env:"
echo "SOROBAN_REGISTRY_ADDRESS=$REGISTRY_ID"
echo "SOROBAN_RENEWAL_ADDRESS=$RENEWAL_ID"
echo "SOROBAN_LOGGING_ADDRESS=$LOGGING_ID"
echo "SOROBAN_ZK_VERIFIER_ADDRESS=$ZK_VERIFIER_ID"
echo "SOROBAN_UPGRADE_ADDRESS=$UPGRADE_ID"

# Write addresses to a local file for reference
OUTPUT_FILE="$(dirname "$0")/deployed-addresses-${NETWORK}.env"
cat > "$OUTPUT_FILE" <<EOF
# Deployed on $NETWORK — $(date -u +"%Y-%m-%dT%H:%M:%SZ")
SOROBAN_REGISTRY_ADDRESS=$REGISTRY_ID
SOROBAN_RENEWAL_ADDRESS=$RENEWAL_ID
SOROBAN_LOGGING_ADDRESS=$LOGGING_ID
SOROBAN_ZK_VERIFIER_ADDRESS=$ZK_VERIFIER_ID
SOROBAN_UPGRADE_ADDRESS=$UPGRADE_ID
EOF
echo ""
echo "Addresses saved to $OUTPUT_FILE"
