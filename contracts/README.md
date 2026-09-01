# Synchro Smart Contracts

Smart contracts for Synchro built on Stellar's Soroban platform. These contracts will handle decentralized subscription management, payment processing, and integration with the Stellar network for future automated payment capabilities.

## Overview

The contracts folder contains Soroban smart contracts that will enable:
- **Decentralized Subscription Management**: Store subscription data on-chain
- **Payment Processing**: Handle crypto payments for subscriptions
- **Stellar Integration**: Prepare for future non-custodial card issuance
- **Gift Card Tracking**: Track gift card purchases and redemptions
- **Automated Payments**: Future phase - automated recurring payments via Stellar

## Tech Stack

- **Platform**: Stellar Soroban
- **Language**: Rust
- **SDK**: Soroban SDK 23
- **Build Tool**: Stellar Contract CLI
- **Testing**: Soroban testutils

## Project Structure

```
contracts/
├── contracts/
│   ├── src/                     # SubscriptionRegistry contract source
│   ├── agent-registry/          # Authorized agents registry contract
│   ├── allowance/               # Recurring allowance / spending-limit authority
│   ├── escrow/                  # Payment holding escrow contract
│   ├── payment-adapter/         # Multi-token renewal settlement adapter
│   ├── resolver-registry/       # Dispute arbitration / resolver registry
│   ├── subscription_logging/    # On-chain audit trail logging contract
│   ├── subscription_renewal/    # Main subscription renewal logic contract
│   ├── voucher-ledger/          # Gift-card voucher mint / redeem / void ledger
│   └── virtual-card/            # Non-custodial virtual card contract
├── scripts/                     # Deployment and initialization scripts
├── docs/                        # Event schema and contract hardening notes
└── Cargo.toml                   # Cargo workspace configuration
```

## Current State (July 2026)

### ✅ Implemented
- **Core Contracts**: Functional renewal, escrow, and registry contracts.
- **On-chain Logging**: Structured audit trail for subscription events.
- **Stellar SDK 26**: Built on the latest Soroban stable release.
- **Test Infrastructure**: Automated snapshots and delegated execution tests.

### ⚠️ Partially Implemented
- **Mainnet Deployment**: Currently undergoing Testnet verification and security hardening.

### ❌ Not Implemented
- **Direct Card Issuance**: Pending Stellar ecosystem availability for non-custodial virtual cards.

**Owner**: Smart Contracts Team
**Update Cadence**: Per Major Contract Change

## Setup

### Prerequisites

1. **Install Rust** (if not already installed):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Install Stellar Contract CLI**:
   ```bash
   cargo install --locked --version 23.0.0 soroban-cli
   ```

3. **Install Stellar CLI** (for network interaction):
   ```bash
   # Follow instructions at https://developers.stellar.org/docs/tools/stellar-cli
   ```

### Building Contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

### Testing Contracts

```bash
cd contracts
cargo test
```

## Implemented Contracts

### 1. Subscription Registry Contract (`contracts/contracts/`)
**Purpose**: Store and manage subscription metadata on-chain.
- `create_subscription` - Create a new subscription with billing interval, expected amount, and next renewal.
- `update_subscription` - Update existing subscription metadata.
- `cancel_subscription` - Deactivate a subscription.
- `get_subscription` - Retrieve subscription metadata by ID.
- `get_user_subscriptions` - Retrieve all subscription IDs for a user.

### 2. Subscription Renewal Contract (`contracts/contracts/subscription_renewal/`)
**Purpose**: Handle subscription renewal payments, cooldown periods, spending caps, and authorization.
- `renew` - Processes subscription renewal.
- `approve_renewal` - Owner approves a renewal with a max spend and expiry.
- `cancel_sub` - Explicitly cancel a subscription.
- `set_executor` / `remove_executor` / `get_executor` - Manage authorized execution agents.
- `set_window` / `get_window` - Manage billing window start/end times.
- `acquire_renewal_lock` / `release_renewal_lock` - Prevent race conditions during concurrent execution.
- `set_user_cap` / `get_user_cap` / `get_user_spent` - Enforce global user spending limits.

### 3. Virtual Card Contract (`contracts/contracts/virtual-card/`)
**Purpose**: Non-custodial virtual card for subscription payments.
- `issue_card` - Issues a new virtual card with initial balance.
- `process_payment` - Debits balance from a card, with auto-close for disposable cards.
- `activate_card` / `deactivate_card` / `suspend_card` - Manage card lifecycle states.
- `verify_ownership` - Asserts if claimant is card holder.
- `can_transact` - Verifies eligibility (active state, expiry, balance).

### 4. Escrow Contract (`contracts/contracts/escrow/`)
**Purpose**: Secure holding of funds with dispute resolution capability.
- `create_escrow` - Initialize escrow agreement.
- `deposit` - Fund the escrow.
- `approve_release` - Provide the second signature (arbiter) to approve release.
- `release` - Payee claims approved funds.
- `refund` - Payer claims refund (either before approval or after expiry).
- `raise_dispute` / `resolve_dispute` - Dispute resolution workflow.

### 5. Agent Registry Contract (`contracts/contracts/agent-registry/`)
**Purpose**: Manage authorized execution agents and their permission scopes.
- `register` / `revoke_agent` - Add or remove agents.
- `update_scopes` - Grant specific scopes (Renewals, GiftCards, Approvals).
- `is_authorized` / `require_authorized` - Verify agent authorization.

### 6. Subscription Logging Contract (`contracts/contracts/subscription_logging/`)
**Purpose**: Maintain an on-chain audit trail of subscription events.
- `record_log` - Appends a log entry (Reminder, Approval, Renewal, Failure, Retry, Cancellation).
- `get_logs` - Query logs for a specific subscription.

### 7. Allowance Contract (`contracts/contracts/allowance/`)
**Purpose**: Standalone recurring allowance / spending-limit authority. Lets an owner pre-authorize a merchant for capped recurring pulls, enforcing both a per-period cap and an absolute (lifetime) cap. Decoupled from subscription renewal.
- `grant_allowance` - Owner authorizes a merchant with a per-period cap, absolute cap, and period length.
- `revoke_allowance` - Owner revokes the authority, immediately blocking further pulls.
- `consume` - Merchant pulls funds (owner → merchant via `transfer_from`); resets the period window when elapsed and enforces both caps.
- `update_caps` - Owner adjusts the per-period and absolute caps (never below already-spent amounts).
- `available` - Query the amount still pullable right now (min of remaining per-period and lifetime budgets).
- `pause` / `unpause` / `is_paused` - Admin circuit-breaker over all consumption.

### 8. Payment Adapter Contract (`contracts/contracts/payment-adapter/`)
**Purpose**: Allowlisted multi-token settlement wrapper for renewal flows.
- `allow_token` - Admin allowlists a Stellar Asset Contract and stores its decimals and cap.
- `revoke_token` - Admin disables a token without deleting historical state.
- `settle_renewal` - Payer-authorized transfer that scales display units into raw token units using the token's decimals.
- `get_policy` / `available` / `is_allowed` - Read the current token policy and remaining cap.

### 9. Voucher Ledger Contract (`contracts/contracts/voucher-ledger/`)
**Purpose**: Gift-card voucher mint / redeem / void ledger with double-spend protection.
- `mint_voucher` - Admin creates a voucher with a unique code hash and face value.
- `redeem_voucher` - Voucher recipient redeems part or all of the balance.
- `void_voucher` - Admin voids an active voucher and clears any remaining balance.

## Global Error Code Registry (#1225)

### Overview

To prevent ambiguity when errors are surfaced across contract boundaries (e.g., renewal → logging), SYNCRO implements a **global, non-overlapping error code registry**. Each contract is allocated a 100-code block to ensure no discriminant collisions.

### Error Code Allocation

| Contract                  | Range      | Description |
|---------------------------|-----------|-------------|
| subscription_renewal      | 1000-1099 | Subscription renewal logic |
| subscription_logging      | 1100-1199 | Event logging |
| virtual-card              | 1200-1299 | Virtual card management |
| escrow                    | 1300-1399 | Escrow agreement handling |
| agent-registry            | 1400-1499 | Agent registry & permissions |
| zk-payment-verifier       | 1500-1599 | Zero-knowledge proof verification |
| payment-channel           | 1600-1699 | Payment channel operations |
| contract-upgrade          | 1700-1799 | Contract upgrade governance |
| allowance                 | 1800-1899 | Recurring allowance management |
| payment-adapter           | 1900-1999 | Payment adapter |
| voucher-ledger            | 2000-2099 | Voucher ledger |
| fee-collector             | 2100-2199 | Fee collection |
| resolver-registry         | 2200-2299 | Resolver registry |
| subscription_refund       | 2300-2399 | Subscription refund logic |
| recurring_allowance       | 2400-2499 | Recurring allowance (legacy) |
| loyalty_rewards           | 2500-2599 | Loyalty rewards |
| subscription_nft          | 2600-2699 | Subscription NFT |
| attestation               | 2700-2799 | Attestation service |
| guardian                  | 2800-2899 | Guardian authority |
| fx-oracle                 | 2900-2999 | FX oracle |
| payment-splitter          | 3000-3099 | Payment splitter |
| stealth-announcement      | 3100-3199 | Stealth payment announcements |

**Total Capacity**: 22 contracts × 100 codes = 2200 codes (range: 1000-3199)

### Error Code Conversion

For a contract with base code B and original error discriminant D:
```
global_code = B + (D - 1)
```

**Example**: `escrow::InvalidAmount = 5` (original) → `1300 + (5 - 1) = 1304` (global)

### Decoding Global Error Codes

**SDK Function**: `decodeContractError(globalCode: number)` in `sdk/src/errors.ts`

```typescript
import { decodeContractError, formatContractError } from '@syncro/sdk';

// Decode a contract error
const decoded = decodeContractError(1304);
// Returns: { globalCode: 1304, contract: "escrow", variant: "InvalidAmount", ... }

// Format for logging
console.log(formatContractError(decoded));
// Output: "Contract Error: escrow::InvalidAmount (code: 1304, local: 5)"
```

### Machine-Readable Registry

All error codes are documented in `contracts/errors.json`:
```json
{
  "1304": {
    "contract": "escrow",
    "variant": "InvalidAmount",
    "global_code": 1304,
    "local_code": 5
  },
  ...
}
```

**Generated**: `python3 scripts/generate-error-registry.py`

### Testing Error Code Overlaps

Verify that no two contracts use the same error code:

```bash
cd contracts/integration_tests
cargo test --test error_registry_tests -- --nocapture
```

Tests validate:
- No discriminant overlaps between contracts
- All error codes fit within allocated ranges
- Round-trip encode/decode correctness

## Contract Version Metadata (#1226)

### Overview

Every contract now exposes version information for deployment traceability and API compatibility detection. This allows the backend to:
- Detect version mismatches at startup
- Log which build was deployed
- Make rollback decisions based on version metadata

### Public Interface

All contracts expose:

```rust
/// Returns the contract version (e.g., 0x00010000 for v1.0.0).
pub fn version(env: Env) -> u32

/// Returns the interface version for API compatibility.
pub fn interface_version(env: Env) -> u32
```

### Version Format

**Contract Version**: `0xMMmmPPPP` (Major.minor.patch)
- Bits 24-31: Major version (breaking changes)
- Bits 16-23: Minor version (new features, backward compatible)
- Bits 0-15: Patch version (bug fixes)

**Example**: `0x00010205` → v1.2.5

### Backend Contract Version Logging

At startup, the backend logs all deployed contract versions:

```typescript
import { initializeContractVersioning } from './services/contract-version-manager';

// During server startup
await initializeContractVersioning();

// Output:
// ============================================================
// Deployed Contract Versions
// ============================================================
// subscription_renewal: v1.0 (interface v1)
// escrow: v1.0 (interface v1)
// virtual-card: v1.0 (interface v1)
// ⚠ version mismatch: SDK expects v1, deployed is v1.1
// ============================================================
```

### Version Mismatch Detection

If the SDK was built against a different version than the deployed contract:

```
[WARN] Version mismatch for escrow: SDK expects v1.0, but deployed contract is v1.1
```

This indicates:
- **Minor/Patch version increase**: Backward compatible, likely safe
- **Major version increase**: Breaking changes, likely requires SDK rebuild
- **Major version decrease**: Rollback occurred, verify compatibility

### Related Issues

- **#1225**: Global unique contract error-code registry
- **#1226**: Add version() and interface_version() to every contract

- `get_voucher` / `balance` / `is_active` - Read voucher state and remaining balance.
### 10. Resolver Registry Contract (`contracts/contracts/resolver-registry/`)
**Purpose**: Decentralize escrow dispute resolution from a single admin arbiter to a voting set of arbiters. When a configurable quorum agrees on an outcome, the registry issues a binding `resolve_dispute` cross-contract call into the escrow. (Wire it up by setting the escrow's `arbiter` to the registry's contract address.)
- `init` - Initialize with an admin and an initial quorum.
- `add_arbiter` / `remove_arbiter` - Admin manages the arbiter voting set.
- `set_quorum` - Admin adjusts the number of matching votes required to bind an outcome.
- `open_case` - An arbiter or admin opens a dispute case bound to an escrow agreement.
- `vote` - An arbiter votes to release (1) or refund (2); reaching quorum fires the binding escrow callback.
- `get_case` / `get_case_count` / `get_quorum` / `get_arbiters` / `is_arbiter` / `get_vote` - Queries.
### 11. Recurring Allowance Contract (`contracts/contracts/recurring_allowance/`)
**Purpose**: Standalone authority contract letting users pre-authorize merchants for capped recurring pulls.
- `grant_allowance` - Grant capped recurring pull authorization with per-period and absolute limits.
- `revoke_allowance` - Revoke an active recurring allowance.
- `consume_allowance` - Merchant pulls authorized tokens within per-period and lifetime caps.
- `update_allowance` - Update parameters for an active allowance.
- `get_allowance` / `get_remaining_period_allowance` / `get_remaining_absolute_allowance` - Query allowance status and remaining capacity.

## Contract Development Roadmap

### Completed (MVP Stage)
- [x] On-chain subscription registry and tracking
- [x] Multi-agent renewal registry with scope controls
- [x] Secure escrow agreements with arbiter-mediated dispute resolution
- [x] Decentralized dispute arbitration via a quorum-voting resolver registry
- [x] Non-custodial virtual cards with disposable/auto-close behavior
- [x] On-chain audit logging system
- [x] Recurring allowance authority with per-period and absolute spending caps
- [x] Multi-token settlement adapter with token allowlists and per-token caps
- [x] On-chain voucher ledger for gift-card balances

### Phase 3: Mainnet Hardening
- [ ] Complete external security audits
- [ ] Gas optimization for complex loops (e.g. multi-agent authorizations)
- [ ] Integration with front-end SDKs

## Event Schema

See [`docs/contract-event-schema.md`](docs/contract-event-schema.md) for the
canonical two-topic event convention used by the contracts and backend
indexer.

## Cross-Contract Trust Matrix

This section defines **which contract may call which entrypoint, and under whose
authority**. Every cross-contract call either **forwards a user's auth** (the
caller is acting on behalf of an authenticated end user) or **acts as the
calling contract's own identity** (the contract self-authenticates).

### Principles

- A callee grants access through the narrowest role possible. Writing to the
  audit trail is a **writer** role, intentionally separate from **admin**.
- No contract must be granted another contract's **admin** role to function.
  Instead, cross-contract writers are registered on explicit allowlists.
- A contract that acts as its own identity (e.g. submitting audit commitments)
  self-authenticates via `require_auth` on its own address; the callee verifies
  that address against its allowlist.

### Consumers of the audit trail (`subscription_logging`)

| Entrypoint | Approved caller | Authority | Auth forwarded? |
|---|---|---|---|
| `record_log(sub_id, event, data)` | Any registered **writer** (e.g. `subscription_renewal`) | Writer allowlist (`add_writer`/`remove_writer`, admin-managed) | No — acts as contract identity |
| `record_commitment(commitment_hash)` | Any registered **writer** (e.g. `subscription_renewal`) | Writer allowlist | No — acts as contract identity |
| `anchor_merkle_root` / `anchor_log_merkle_root` / `prune_logs` | Logging **admin** only | Admin role | No |
| `add_writer` / `remove_writer` | Logging **admin** only | Admin role | No |
| `get_logs` / `get_commitment*` / `get_merkle_root*` / `is_writer` / `get_writers` | Anyone (read-only) | — | — |

### `subscription_renewal` cross-contract calls

| Callee | Entrypoint | Caller identity | Auth forwarded? | Required grant on callee |
|---|---|---|---|---|
| `subscription_logging` | `record_commitment(hash)` → from `init_sub`, `cancel_sub`, `renew` (success/failure/retry) | Renewal **contract** | No — renewal acts as its own identity | Register renewal as a **writer** |
| SAC (token) | `transfer(owner → renewal)` — escrow lock in `renew` | Owner (holder of funds) | Yes — forwards **owner** auth | None (owner auths the transfer) |
| SAC (token) | `transfer(renewal → merchant)` — escrow claim in `claim_escrow` | Merchant (recipient) | Yes — forwards **merchant** auth | None (merchant auths the claim) |
| `virtual-card` *(intended)* | `issue_card` / `process_payment` | Card holder | Yes — forwards **holder** auth | None (holder auths) |

### `virtual-card` cross-contract / entrypoint auth

| Entrypoint | Approved caller | Authority |
|---|---|---|
| `issue_card(user, …)` | The `user` (or an upstream contract calling on the user's behalf) | Per-user `user.require_auth()` |
| `process_payment(card_id, …)` | The card **holder** | `card.holder.require_auth()` |
| `set_merchant_allowlist` / `blocklist`, `activate_card`, `deactivate_card`, `suspend_card` | The card **holder** | `caller == holder` + `caller.require_auth()` |
| `verify_ownership` / `can_transact` / `get_*` / `remaining_*` | Anyone (read-only) | — |

`subscription_renewal` is **intended** to call `virtual-card` (card funding on
renewal), matching the auth-forwarding model above: the card holder's auth is
required, so `virtual-card` never needs `subscription_renewal` to be its admin.

### Audit trail of this model (Issue #1233)

- `record_log` and `record_commitment` are now gated by a **writer allowlist**
  distinct from admin, so `subscription_renewal` is a *writer*, never an admin.
- Negative tests (`subscription_logging/src/test.rs`, `integration_tests`)
  prove that an unregistered contract and a direct end-user call are rejected
  for every cross-contract write entrypoint.

## Development Guidelines

### Code Style
- Follow Rust naming conventions (snake_case for functions, PascalCase for types)
- Write comprehensive tests for all contract functions
- Document all public functions with doc comments
- Use meaningful variable names

### Testing
- Write unit tests for each function
- Test edge cases and error conditions
- Test access control and permissions
- Test with different user scenarios

### Security
- Validate all inputs
- Implement proper access control
- Avoid storing sensitive data on-chain
- Use secure random number generation when needed
- Follow Soroban security best practices

## Related Documentation

- See main `/README.md` for project overview
- See `/backend/README.md` for backend integration details
- See `/client/README.md` for frontend integration

## Notes

- Contracts are in the MVP hardening stage.
- All core contracts are verified on Stellar Testnet.
- Focus is currently on integration testing and gas profiling.
