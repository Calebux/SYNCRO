# Contract Upgrade Runbook

## Overview

This document describes the process for upgrading Soroban smart contracts using the
`ContractUpgradeGovernance` contract. The upgrade mechanism provides:

- **Multi-sig governance**: 2-of-3 guardian approval required
- **Time-lock**: 48-hour delay between approval and execution (configurable, min 1 hour)
- **Rollback capability**: One-click revert to previous WASM version
- **Event emission**: All lifecycle events emitted for off-chain indexing
- **Emergency pause**: Admin can pause/unpause the upgrade system

## Architecture

```
Guardian 1 ----> Propose ----> Approve (2-of-3) ----> Timelock (48h) ----> Execute
Guardian 2 ---/                                                 |
Guardian 3 ---/                                          Rollback Available
                                                                 |
                                                          Admin Emergency
                                                          Rollback
```

## Environment Variables

Add to `backend/.env`:

```env
SOROBAN_UPGRADE_ADDRESS=<deployed_contract_upgrade_id>
```

## Guardian Setup

On first deployment, the contract is initialized with an admin and 2-3 guardians:

```bash
GUARDIAN_1="G..."
GUARDIAN_2="G..."
GUARDIAN_3="G..."

stellar contract invoke \
  --id "$SOROBAN_UPGRADE_ADDRESS" \
  --source "$STELLAR_SECRET_KEY" \
  --network testnet \
  -- init \
  --admin "$ADMIN_ADDRESS" \
  --guardaries "[\"$GUARDIAN_1\",\"$GUARDIAN_2\",\"$GUARDIAN_3\"]"
```

## Upgrade Flow

### 1. Build and Deploy New WASM

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release -p subscription_renewal
NEW_WASM_HASH=$(sha256sum target/wasm32-unknown-unknown/release/subscription_renewal.wasm | cut -d' ' -f1)
```

### 2. Propose Upgrade

```bash
stellar contract invoke \
  --id "$SOROBAN_UPGRADE_ADDRESS" \
  --source "$GUARDIAN_1_SECRET" \
  --network testnet \
  -- propose_upgrade \
  --proposer "$GUARDIAN_1_ADDRESS" \
  --target_contract "$CURRENT_CONTRACT_ID" \
  --new_wasm_hash "$NEW_WASM_HASH" \
  --previous_wasm_hash "$OLD_WASM_HASH" \
  --description "Upgrade to v2.1.0 - adds spending cap"
```

### 3. Approve (2-of-3 Guardians)

Guardian 2 and then Guardian 3 approve:

```bash
stellar contract invoke \
  --id "$SOROBAN_UPGRADE_ADDRESS" \
  --source "$GUARDIAN_2_SECRET" \
  --network testnet \
  -- approve_upgrade \
  --proposal_id 1 \
  --guardian "$GUARDIAN_2_ADDRESS"
```

### 4. Wait for Timelock

Default: **48 hours**. Check remaining time via `get_proposal`.

### 5. Execute Upgrade

```bash
stellar contract invoke \
  --id "$SOROBAN_UPGRADE_ADDRESS" \
  --source "$GUARDIAN_1_SECRET" \
  --network testnet \
  -- execute_upgrade \
  --proposal_id 1 \
  --executor "$GUARDIAN_1_ADDRESS" \
  --new_wasm_hash "$NEW_WASM_HASH"

# Then deploy new WASM to the target contract
stellar contract upgrade \
  --id "$CURRENT_CONTRACT_ID" \
  --wasm target/wasm32-unknown-unknown/release/subscription_renewal.wasm \
  --source "$STELLAR_SECRET_KEY" \
  --network testnet
```

## Rollback Procedure

### Emergency Admin Rollback

```bash
stellar contract invoke \
  --id "$SOROBAN_UPGRADE_ADDRESS" \
  --source "$ADMIN_SECRET" \
  --network testnet \
  -- rollback_upgrade \
  --caller "$ADMIN_ADDRESS" \
  --previous_wasm_hash "$OLD_WASM_HASH"

# Deploy the previous WASM version
stellar contract upgrade \
  --id "$CURRENT_CONTRACT_ID" \
  --wasm path/to/previous_version.wasm \
  --source "$STELLAR_SECRET_KEY" \
  --network testnet
```

## Monitoring

All upgrade lifecycle events are logged in `contract_upgrade_events`:

| Event Type     | Description                           |
|----------------|---------------------------------------|
| `proposed`     | A new upgrade was proposed            |
| `approved`     | A guardian approved the proposal      |
| `ready`        | Timelock expired, ready for execution |
| `executed`     | Upgrade was executed                  |
| `rolled_back`  | Upgrade was rolled back               |
| `cancelled`    | Proposal was cancelled                |

## Security Considerations

1. **Guardian key custody**: Each guardian key should be held by a different person
2. **Timelock**: 48-hour window allows stakeholders to halt a malicious upgrade
3. **Rollback**: Only one rollback slot per upgrade; new proposal needed after
4. **Admin key**: Use multisig or hardware wallet for admin key
5. **WASM hash verification**: Always verify hash matches built artifact
6. **Test on testnet first**: Always run full upgrade flow on testnet before mainnet

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| `NotGuardian` | Signer not registered | Check `get_guardians()` |
| `TimelockNotExpired` | Execution before timelock | Wait or check `executable_at` |
| `RollbackAlreadyConsumed` | Rollback already used | New proposal required |
| `InvalidStateTransition` | Proposal in wrong state | Check via `get_proposal()` |
| `UpgradesPaused` | System paused | Admin calls `toggle_pause()` |
