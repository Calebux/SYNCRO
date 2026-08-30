# Contract Deployment Guide

## Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-cli/install-and-setup) v21
+- Rust with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- * Funded Stellar account (testnet accounts can be funded via [Friendbot](https://friendbot.stellar.org))
- `STELLAR_SECRET_KEY` environment variable set to your account's secret key (`S...`)

Fund a new testnet account:
```bash
stellar keys generate --global deployer --network testnet --fund
export STELLAR_SECRET_KEY=$(stellar keys show deployer)
```

---

## Admin Governance: Single-Admin vs. Multisig

### v1: Single-Admin (Default for New Deployments)

Contracts are initialized with a single admin address:

```bash
stellar contract invoke \
  --id CAD3D... \
  -- init \
  --admin GAKXX...
```

All administrative operations (pause, cap changes, etc.) require only the admin's signature:
- `set_paused(true)` - Admin only
- `set_user_cap(user, cap)` - Admin only
- `set_logging_contract(addr)` - Admin only

### v2: Guardian Multisig (Enhanced Security)

**After initial deployment**, migrate to multisig governance:

```bash
stellar contract invoke \
  --id CAD3D... \
  -- migrate_admin_to_multisig \
  --guardians '[GUARDIAN1, GUARDIAN2, GUARDIAN3]'
```

After migration, all destructive operations require **2-of-M threshold approvals**.

---

## Guardian Key Rotation Runbook

Guardian key rotation allows you to replace a compromised or retired guardian key without stopping contract operations.

### Prerequisites
- Multisig mode enabled (`migrate_admin_to_multisig` was called)
- Knowledge of at least 2 current guardian keys (threshold for approval)
- The new guardian address (can be generated fresh)

### Step-by-Step Rotation

#### Step 1: Identify Current Guardians
```bash
stellar contract invoke \
  --id CAD3D... \
  -- get_guardians
# Returns: [G1, G2, G3]
```

#### Step 2: Prepare New Guardian Set
- **Scenario A**: Replace G1 with G_new (2 of 3 guardians)
  - Current: [G1, G2, G3]
  - New: [G_new, G2, G3]

- **Scenario B**: Expand from 2 to 3 guardians (increase security)
  - Current: [G1, G2]
  - New: [G1, G2, G_new]

#### Step 3: Propose Guardian Change (Guardian Only)

One guardian initiates the proposal:

```bash
PROPOSAL_ID=$(stellar contract invoke \
  --id CAD3D... \
  -- propose_guardian_change \
  --proposer G1 \
  --new_guardians '[G_new, G2, G3]' \
  | jq '.proposal_id')

echo "Proposal ID: $PROPOSAL_ID"
```

#### Step 4: Collect Approvals (Any 2 Guardians)

Second guardian approves:
```bash
stellar contract invoke \
  --id CAD3D... \
  -- approve_proposal \
  --proposal_id $PROPOSAL_ID \
  --guardian G2
```

Third guardian approves (only 2 needed, but more provides redundancy):
```bash
stellar contract invoke \
  --id CAD3D... \
  -- approve_proposal \
  --proposal_id $PROPOSAL_ID \
  --guardian G3
```

#### Step 5: Execute Guardian Change

Once threshold (2) is reached, execute:

```bash
stellar contract invoke \
  --id CAD3D... \
  -- execute_guardian_change \
  --proposal_id $PROPOSAL_ID \
  --new_guardians '[G_new, G2, G3]'
```

#### Step 6: Verify

Confirm the new guardian set:
```bash
stellar contract invoke \
  --id CAD3D... \
  -- get_guardians
# Should return: [G_new, G2, G3]
```

### Emergency Key Rotation (Key Compromise)

If a guardian key is compromised **immediately**:

1. **Do NOT propose removal** (compromised guardian could block)
2. **Invoke directly with other guardians** - use the fast path:
   ```bash
   stellar contract invoke \
     --id CAD3D... \
     -- propose_guardian_change \
     --proposer G2 \
     --new_guardians '[G2, G3, G_new]'  # Skip the compromised G1
   ```

3. **Collect 2 approvals** from uncompromised guardians (G2, G3, etc.)
4. **Execute immediately**

### Key Rotation Matrix

| Scenario | Action | Approvals Needed | Time to Effect |
|----------|--------|------------------|-----------------|
| Add guardian (2→3) | propose → approve → execute | 2-of-2 | 3 txs |
| Remove guardian (3→2) | propose → approve → execute | 2-of-3 | 3 txs |
| Replace guardian | propose new set → approve → execute | 2-of-M | 3 txs |
| Emergency (key compromise) | propose removal → approve → execute | 2-of-remaining | 3 txs, ASAP |

### Monitoring & Auditing

Track all guardian changes via contract events:

```bash
# Query recent guardian change events
stellar events query \
  --contract-id CAD3D... \
  --type GuardianSetChanged \
  --limit 10
```

Each `GuardianSetChanged` event emits:
- `guardians`: New set of addresses
- `threshold`: Approval threshold (always 2 for current implementation)
- Ledger sequence and timestamp

---

## Testnet Deployment

Run the deploy script from the `contracts/` directory:

```bash
cd contracts
bash scripts/deploy.sh testnet
```
This will:
1. Build all five contracts to WASM
2. Deploy `SubscriptionRegistry`, `SubscriptionRenewal`, `SubscriptionLogging`, `ZkPaymentVerifier`, and `ContractUpgradeGovernance`
3. Run `init.sh` to initialize each contract and link the logging contract to the renewal contract
4. Print the contract addresses and save them to `scripts/deployed-addresses-testnet.env`

### Post-Deployment: Enable Multisig (Recommended)

After testing the deployment, migrate critical contracts to multisig:

```bash
# Get the deployment addresses
source scripts/deployed-addresses-testnet.env

# Create guardian set (3-of-3 for testnet)
GUARDIAN1=$(stellar keys show guardian1)
GUARDIAN2=$(stellar keys show guardian2)
GUARDIAN3=$(stellar keys show guardian3)

# Migrate subscription renewal contract
stellar contract invoke \
  --id $SUBSCRIPTION_RENEWAL_CONTRACT_ID \
  -- migrate_admin_to_multisig \
  --guardians "[$GUARDIAN1, $GUARDIAN2, $GUARDIAN3]"
```

---

## Mainnet Deployment (Checklist)

- [ ] All contracts built and tested on testnet
- [ ] Admin multisig enabled (`migrate_admin_to_multisig` completed)
- [ ] Guardian keys secured (hardware wallet recommended)
- [ ] At least 3 independent guardians from different teams/regions
- [ ] Key recovery procedures documented
- [ ] Escrow addresses configured and funded
- [ ] Cross-contract linker addresses verified
- [ ] Pause flag set to `false` (contracts active)
- [ ] Deployment verified with smoke tests
- [ ] Guardian rotation runbook reviewed and tested

