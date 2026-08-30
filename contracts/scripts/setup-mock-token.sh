#!/bin/bash
set -e

# setup-mock-token.sh
#
# Issues a mock Stellar asset, deploys its Stellar Asset Contract (SAC), funds
# a handful of test accounts with it, and (optionally) wires the resulting
# token address into an already-deployed SubscriptionRenewal contract via
# `set_token_contract`, so the escrow-locking flow has an asset to move.
#
# Usage:
#   bash scripts/setup-mock-token.sh <network> [renewal_contract_id]
#
# Env vars:
#   TOKEN_CODE       Asset code for the mock token (default: MOCK)
#   NUM_TEST_USERS   How many funded test-user identities to create (default: 2)
#
# Requires: Stellar CLI v21+ (`stellar`), network access to Friendbot for the
# chosen network (testnet/futurenet).

NETWORK=${1:-testnet}
RENEWAL_ID=${2:-${SOROBAN_RENEWAL_ADDRESS:-''}}
TOKEN_CODE=${TOKEN_CODE:-MOCK}
NUM_TEST_USERS=${NUM_TEST_USERS:-2}

SCRIPT_DIR="$(dirname "$0")"

echo "==> Setting up mock token '$TOKEN_CODE' on $NETWORK"

# 1. Generate (or reuse) a funded issuer identity for the mock asset.
ISSUER_KEY="mock-token-issuer"
if ! stellar keys address "$ISSUER_KEY" >/dev/null 2>&1; then
  echo "  Generating issuer identity: $ISSUER_KEY"
  stellar keys generate "$ISSUER_KEY" --network "$NETWORK" --fund
else
  echo "  Reusing existing issuer identity: $ISSUER_KEY"
fi
ISSUER_ADDRESS=$(stellar keys address "$ISSUER_KEY")
echo "  Issuer: $ISSUER_ADDRESS"

# 2. Deploy the Stellar Asset Contract (SAC) that wraps TOKEN_CODE:ISSUER.
#    This is the contract address you pass to `set_token_contract` on
#    SubscriptionRenewal.
echo ""
echo "==> Deploying Stellar Asset Contract for $TOKEN_CODE:$ISSUER_ADDRESS..."
TOKEN_ID=$(stellar contract asset deploy \
  --source "$ISSUER_KEY" \
  --network "$NETWORK" \
  --asset "$TOKEN_CODE:$ISSUER_ADDRESS")
echo "  Token contract: $TOKEN_ID"

# 3. Generate funded test-user identities, establish trustlines to the mock
#    asset, and mint each of them a starting balance.
MINT_AMOUNT=${MINT_AMOUNT:-100000000000} # 10,000.0000000 (7 decimals)
TEST_USER_ADDRESSES=()

echo ""
echo "==> Creating $NUM_TEST_USERS test user(s) and minting $TOKEN_CODE..."
for i in $(seq 1 "$NUM_TEST_USERS"); do
  USER_KEY="mock-token-user-$i"

  if ! stellar keys address "$USER_KEY" >/dev/null 2>&1; then
    echo "  Generating test user: $USER_KEY"
    stellar keys generate "$USER_KEY" --network "$NETWORK" --fund
  else
    echo "  Reusing existing test user: $USER_KEY"
  fi
  USER_ADDRESS=$(stellar keys address "$USER_KEY")

  echo "  Establishing trustline for $USER_KEY ($USER_ADDRESS)..."
  stellar tx new change-trust \
    --source "$USER_KEY" \
    --network "$NETWORK" \
    --line "$TOKEN_CODE:$ISSUER_ADDRESS" \
    --limit 1000000000000000000 >/dev/null

  echo "  Minting $MINT_AMOUNT (stroops) of $TOKEN_CODE to $USER_ADDRESS..."
  stellar contract invoke \
    --id "$TOKEN_ID" \
    --source "$ISSUER_KEY" \
    --network "$NETWORK" \
    -- mint \
    --to "$USER_ADDRESS" \
    --amount "$MINT_AMOUNT" >/dev/null

  TEST_USER_ADDRESSES+=("$USER_ADDRESS")
  echo "  $USER_KEY funded: $USER_ADDRESS"
done

# 4. If a SubscriptionRenewal contract id was supplied, wire the mock token in
#    as the escrow asset so `renew` / `claim_escrow` can move real balances.
if [ -n "$RENEWAL_ID" ]; then
  echo ""
  echo "==> Linking mock token to SubscriptionRenewal ($RENEWAL_ID)..."
  stellar contract invoke \
    --id "$RENEWAL_ID" \
    --source "$ISSUER_KEY" \
    --network "$NETWORK" \
    -- set_token_contract \
    --address "$TOKEN_ID"
  echo "  Token contract linked. Note: this must be run with the contract's"
  echo "  admin key — re-run with --source <admin_key> if $ISSUER_KEY is not admin."
else
  echo ""
  echo "==> No renewal contract id supplied — skipping set_token_contract."
  echo "    Run again with: bash scripts/setup-mock-token.sh $NETWORK <renewal_contract_id>"
fi

# 5. Persist everything for reuse (backend .env, other scripts, manual testing).
OUTPUT_FILE="$SCRIPT_DIR/mock-token-${NETWORK}.env"
{
  echo "# Mock token setup on $NETWORK — $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "MOCK_TOKEN_CODE=$TOKEN_CODE"
  echo "MOCK_TOKEN_ISSUER=$ISSUER_ADDRESS"
  echo "SOROBAN_MOCK_TOKEN_ADDRESS=$TOKEN_ID"
  for idx in "${!TEST_USER_ADDRESSES[@]}"; do
    echo "MOCK_TOKEN_TEST_USER_$((idx + 1))=${TEST_USER_ADDRESSES[$idx]}"
  done
} > "$OUTPUT_FILE"

echo ""
echo "==> Mock token setup complete."
echo "SOROBAN_MOCK_TOKEN_ADDRESS=$TOKEN_ID"
echo "Details saved to $OUTPUT_FILE"