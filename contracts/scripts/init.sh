#!/bin/bash
set -e

# Usage: init.sh <network> <secret_key> [upgrade_contract_id]
# Can be run standalone after deploy.sh, or called by deploy.sh automatically.
#
# NOTE (issue #1429): subscription_renewal and subscription_logging were
# removed from the v3 design; only ContractUpgradeGovernance is initialized
# here now.

NETWORK=${1:-testnet}
SECRET_KEY=${2:-${STELLAR_SECRET_KEY:?'STELLAR_SECRET_KEY required'}}
UPGRADE_ID=${3:-${SOROBAN_UPGRADE_ADDRESS:-''}}

# Resolve admin address from the deployer key
ADMIN_ADDRESS=$(stellar keys address "$SECRET_KEY" 2>/dev/null || \
  stellar keys show "$SECRET_KEY" --network "$NETWORK" | grep -oP 'G[A-Z0-9]{55}' | head -1)

echo "==> Initializing contracts on $NETWORK"
echo "    Admin: $ADMIN_ADDRESS"

# Initialize ContractUpgradeGovernance (if available)
if [ -n "$UPGRADE_ID" ]; then
  echo "  Initializing ContractUpgradeGovernance..."
  # Generate two guardian addresses from the deployer key (we use same key for now)
  # In production, replace these with actual separate guardian keys
  GUARDIAN_1="$ADMIN_ADDRESS"
  GUARDIAN_2="$ADMIN_ADDRESS"
  GUARDIAN_3="$ADMIN_ADDRESS"

  stellar contract invoke \
    --id "$UPGRADE_ID" \
    --source "$SECRET_KEY" \
    --network "$NETWORK" \
    -- init \
    --admin "$ADMIN_ADDRESS" \
    --guardaries "[\"$GUARDIAN_1\",\"$GUARDIAN_2\",\"$GUARDIAN_3\"]"
  echo "  ContractUpgradeGovernance initialized."
  echo "  NOTE: In production, replace guardians with distinct keypairs."
fi

echo ""
echo "==> Initialization complete."
