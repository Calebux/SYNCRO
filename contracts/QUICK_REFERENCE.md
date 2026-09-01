# Quick Reference: Contract Multisig & Budgets

**Updated**: August 30, 2026  
**Status**: ✅ Implementation Complete

---

## 🚀 Quick Deploy

```bash
# Step 1: Deploy with single admin (backward compatible)
stellar contract invoke --id CONTRACT -- init --admin GAKXX...

# Step 2: Test single-admin mode
stellar contract invoke --id CONTRACT -- set_paused --paused true

# Step 3: Enable multisig (one-time, irreversible)
stellar contract invoke --id CONTRACT -- migrate_admin_to_multisig \
  --guardians '[G1, G2, G3]'

# Step 4: Verify multisig enabled
stellar contract invoke --id CONTRACT -- get_guardians
```

---

## 🔐 Multisig Operations

### Standard Pattern (Set Pause as Example)

```bash
# 1. Propose (any guardian)
PROPOSAL=$(stellar contract invoke --id CONTRACT \
  -- propose_set_paused --proposer G1 --paused true | jq -r '.proposal_id')

# 2. Approve (2 of M needed)
stellar contract invoke --id CONTRACT \
  -- approve_proposal --proposal_id $PROPOSAL --guardian G2

# 3. Execute (after threshold reached)
stellar contract invoke --id CONTRACT \
  -- execute_set_paused --proposal_id $PROPOSAL
```

### Operations Supporting Multisig
- `propose_set_paused() / execute_set_paused()` - Pause protocol
- `propose_set_user_cap() / execute_set_user_cap()` - Spending limits
- `propose_set_logging_contract() / execute_set_logging_contract()` - Logging
- `propose_set_token_contract() / execute_set_token_contract()` - Token
- `propose_guardian_change() / execute_guardian_change()` - Guardian rotation

---

## 🚨 Emergency: Key Compromise

```bash
# If Guardian1 compromised, immediately propose removal:
stellar contract invoke --id CONTRACT \
  -- propose_guardian_change \
  --proposer G2 \
  --new_guardians '[G2, G3, G4]'  # Skip compromised G1

# Get 2 approvals from uncompromised guardians
# Execute immediately (no delay needed)
```

---

## 📊 Budget Snapshots

### Top Expensive Operations
| Operation | CPU | Memory |
|-----------|-----|--------|
| renew (worst) | 268k | 32 KB |
| execute_payment (worst) | 145k | 28 KB |
| resolve_dispute (worst) | 85k | 20 KB |

### CI Regression Detection
- **Baseline**: budgets.json
- **Tolerance**: 5% (cargo test detects violations)
- **Runtime**: < 2 minutes

---

## 📝 Test Single-Admin Mode (Before Migration)

```bash
# Single admin can directly pause
stellar contract invoke --id CONTRACT -- set_paused --paused true

# Single admin can set user cap directly
stellar contract invoke --id CONTRACT \
  -- set_user_cap --user GUSER... --cap 1000

# After migration, these fail (use propose/execute)
```

---

## ✅ Verification Commands

```bash
# Check if multisig enabled
stellar contract invoke --id CONTRACT -- is_multisig_enabled
# Returns: true or false

# Get current guardians
stellar contract invoke --id CONTRACT -- get_guardians
# Returns: [G1, G2, G3]

# Get proposal status
stellar contract invoke --id CONTRACT \
  -- get_proposal --proposal_id 1
# Returns: {state: "Approved", ...}

# Get approvals for proposal
stellar contract invoke --id CONTRACT \
  -- get_proposal_approvals --proposal_id 1
# Returns: [G1, G2]
```

---

## 📋 Guardian Rotation Matrix

| Scenario | Action | Approvals | Time |
|----------|--------|-----------|------|
| Add guardian (2→3) | propose_guardian_change | 2-of-2 | 3 txs |
| Remove guardian (3→2) | propose_guardian_change | 2-of-3 | 3 txs |
| Replace key | propose_guardian_change | 2-of-M | 3 txs |
| **Emergency (compromised)** | **propose_guardian_change** | **2-of-remaining** | **3 txs ASAP** |

---

## 🔍 Monitoring

### Events to Watch
```bash
# Track all guardian changes
stellar events query \
  --contract-id CONTRACT \
  --type GuardianSetChanged \
  --limit 10
```

### Proposal Lifecycle Events
- `AdminProposalCreated` - New proposal
- `AdminProposalApproved` - New approval (includes approval count)
- `AdminProposalExecuted` - Proposal executed

---

## 📖 Full Documentation

| Document | When to Read |
|----------|--------------|
| `DEPLOYMENT.md` | **Guardian rotation procedures** |
| `IMPLEMENTATION_SUMMARY.md` | Architecture and design |
| `VERIFICATION_REPORT.md` | File-by-file checklist |
| `MIGRATION_COMPLETE.md` | Executive summary |
| `DELIVERABLES.md` | Complete file index |

---

## ⚡ Common Tasks

### Enable Multisig on Testnet
```bash
stellar contract invoke --id $CONTRACT_ID -- migrate_admin_to_multisig \
  --guardians "[$(stellar keys show g1), $(stellar keys show g2), $(stellar keys show g3)]"
```

### Test Guardian Rotation
```bash
# Propose: [G1, G2, G4] (remove G3, add G4)
PROPOSAL=$(stellar contract invoke --id CONTRACT \
  -- propose_guardian_change \
  --proposer G1 \
  --new_guardians "[G1, G2, G4]" | jq -r '.proposal_id')

# Approve
stellar contract invoke --id CONTRACT \
  -- approve_proposal --proposal_id $PROPOSAL --guardian G2

# Execute
stellar contract invoke --id CONTRACT \
  -- execute_guardian_change --proposal_id $PROPOSAL \
  --new_guardians "[G1, G2, G4]"

# Verify
stellar contract invoke --id CONTRACT -- get_guardians
```

### Monitor Budget Regressions
```bash
cd contracts
cargo test --release -- --nocapture 2>&1 | grep -E "REGRESSION|Budget"
```

---

## ❓ Troubleshooting

**Q: "Use propose_set_paused + approve_proposal + execute_set_paused"**  
A: Contract is in multisig mode. Use dual-path API.

**Q: "Only guardians can propose operations"**  
A: Caller is not in guardian set. Call migrate_admin_to_multisig first or add to set.

**Q: "Guardian has already approved this proposal"**  
A: Cannot approve twice. Get different guardian.

**Q: "Proposal must be in Approved state to execute"**  
A: Need 2 approvals first (threshold not met).

**Q: Contract exceeds tolerance by X%**  
A: Optimization intended? Update budgets.json, else investigate regression.

---

*Quick Reference for SYNCRO Contract v2 - Multisig & Budgets*
