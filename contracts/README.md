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


## Negative-path test matrix

Every public entrypoint must have `neg_{fn}_unauthorized` and `neg_{fn}_wrong_state`
tests. Crates that transfer SEP-41 tokens must also include a
`malicious_token_reentrancy_*` test. CI runs
`node contracts/scripts/check-negative-path-coverage.mjs`, which fails when a
new entrypoint is added without those tests or when this table drifts from
`src/lib.rs`.


<!-- BEGIN NEGATIVE-PATH-MATRIX -->

| Contract | Entrypoint | Unauthorized test | Wrong-state test | Token reentrancy |
|---|---|---|---|---|
| `agent-registry` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `agent-registry` | `get_admin` | `neg_get_admin_unauthorized` | `neg_get_admin_wrong_state` | n/a |
| `agent-registry` | `get_pending_admin` | `neg_get_pending_admin_unauthorized` | `neg_get_pending_admin_wrong_state` | n/a |
| `agent-registry` | `transfer_admin` | `neg_transfer_admin_unauthorized` | `neg_transfer_admin_wrong_state` | n/a |
| `agent-registry` | `cancel_transfer_admin` | `neg_cancel_transfer_admin_unauthorized` | `neg_cancel_transfer_admin_wrong_state` | n/a |
| `agent-registry` | `accept_admin` | `neg_accept_admin_unauthorized` | `neg_accept_admin_wrong_state` | n/a |
| `agent-registry` | `register` | `neg_register_unauthorized` | `neg_register_wrong_state` | n/a |
| `agent-registry` | `update_scopes` | `neg_update_scopes_unauthorized` | `neg_update_scopes_wrong_state` | n/a |
| `agent-registry` | `revoke_agent` | `neg_revoke_agent_unauthorized` | `neg_revoke_agent_wrong_state` | n/a |
| `agent-registry` | `is_authorized` | `neg_is_authorized_unauthorized` | `neg_is_authorized_wrong_state` | n/a |
| `agent-registry` | `require_authorized` | `neg_require_authorized_unauthorized` | `neg_require_authorized_wrong_state` | n/a |
| `agent-registry` | `has_scope` | `neg_has_scope_unauthorized` | `neg_has_scope_wrong_state` | n/a |
| `agent-registry` | `require_scope` | `neg_require_scope_unauthorized` | `neg_require_scope_wrong_state` | n/a |
| `allowance` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | required |
| `allowance` | `pause` | `neg_pause_unauthorized` | `neg_pause_wrong_state` | required |
| `allowance` | `unpause` | `neg_unpause_unauthorized` | `neg_unpause_wrong_state` | required |
| `allowance` | `is_paused` | `neg_is_paused_unauthorized` | `neg_is_paused_wrong_state` | required |
| `allowance` | `grant_allowance` | `neg_grant_allowance_unauthorized` | `neg_grant_allowance_wrong_state` | required |
| `allowance` | `revoke_allowance` | `neg_revoke_allowance_unauthorized` | `neg_revoke_allowance_wrong_state` | required |
| `allowance` | `update_caps` | `neg_update_caps_unauthorized` | `neg_update_caps_wrong_state` | required |
| `allowance` | `consume` | `neg_consume_unauthorized` | `neg_consume_wrong_state` | required |
| `allowance` | `get_allowance` | `neg_get_allowance_unauthorized` | `neg_get_allowance_wrong_state` | required |
| `allowance` | `get_allowance_count` | `neg_get_allowance_count_unauthorized` | `neg_get_allowance_count_wrong_state` | required |
| `allowance` | `available` | `neg_available_unauthorized` | `neg_available_wrong_state` | required |
| `attestation` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `attestation` | `issue` | `neg_issue_unauthorized` | `neg_issue_wrong_state` | n/a |
| `attestation` | `revoke` | `neg_revoke_unauthorized` | `neg_revoke_wrong_state` | n/a |
| `attestation` | `verify` | `neg_verify_unauthorized` | `neg_verify_wrong_state` | n/a |
| `attestation` | `get_record` | `neg_get_record_unauthorized` | `neg_get_record_wrong_state` | n/a |
| `contract-upgrade` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `contract-upgrade` | `get_guardians` | `neg_get_guardians_unauthorized` | `neg_get_guardians_wrong_state` | n/a |
| `contract-upgrade` | `get_guardian_count` | `neg_get_guardian_count_unauthorized` | `neg_get_guardian_count_wrong_state` | n/a |
| `contract-upgrade` | `set_guardians` | `neg_set_guardians_unauthorized` | `neg_set_guardians_wrong_state` | n/a |
| `contract-upgrade` | `register_governed_contract` | `neg_register_governed_contract_unauthorized` | `neg_register_governed_contract_wrong_state` | n/a |
| `contract-upgrade` | `unregister_governed_contract` | `neg_unregister_governed_contract_unauthorized` | `neg_unregister_governed_contract_wrong_state` | n/a |
| `contract-upgrade` | `get_governed_contracts` | `neg_get_governed_contracts_unauthorized` | `neg_get_governed_contracts_wrong_state` | n/a |
| `contract-upgrade` | `is_governed` | `neg_is_governed_unauthorized` | `neg_is_governed_wrong_state` | n/a |
| `contract-upgrade` | `set_contract_timelock` | `neg_set_contract_timelock_unauthorized` | `neg_set_contract_timelock_wrong_state` | n/a |
| `contract-upgrade` | `get_contract_timelock` | `neg_get_contract_timelock_unauthorized` | `neg_get_contract_timelock_wrong_state` | n/a |
| `contract-upgrade` | `propose_upgrade` | `neg_propose_upgrade_unauthorized` | `neg_propose_upgrade_wrong_state` | n/a |
| `contract-upgrade` | `propose_batch_upgrade` | `neg_propose_batch_upgrade_unauthorized` | `neg_propose_batch_upgrade_wrong_state` | n/a |
| `contract-upgrade` | `approve_upgrade` | `neg_approve_upgrade_unauthorized` | `neg_approve_upgrade_wrong_state` | n/a |
| `contract-upgrade` | `execute_upgrade` | `neg_execute_upgrade_unauthorized` | `neg_execute_upgrade_wrong_state` | n/a |
| `contract-upgrade` | `execute_batch_upgrade` | `neg_execute_batch_upgrade_unauthorized` | `neg_execute_batch_upgrade_wrong_state` | n/a |
| `contract-upgrade` | `rollback_upgrade` | `neg_rollback_upgrade_unauthorized` | `neg_rollback_upgrade_wrong_state` | n/a |
| `contract-upgrade` | `cancel_proposal` | `neg_cancel_proposal_unauthorized` | `neg_cancel_proposal_wrong_state` | n/a |
| `contract-upgrade` | `set_timelock` | `neg_set_timelock_unauthorized` | `neg_set_timelock_wrong_state` | n/a |
| `contract-upgrade` | `get_timelock` | `neg_get_timelock_unauthorized` | `neg_get_timelock_wrong_state` | n/a |
| `contract-upgrade` | `toggle_pause` | `neg_toggle_pause_unauthorized` | `neg_toggle_pause_wrong_state` | n/a |
| `contract-upgrade` | `is_paused` | `neg_is_paused_unauthorized` | `neg_is_paused_wrong_state` | n/a |
| `contract-upgrade` | `get_proposal` | `neg_get_proposal_unauthorized` | `neg_get_proposal_wrong_state` | n/a |
| `contract-upgrade` | `get_batch_proposal` | `neg_get_batch_proposal_unauthorized` | `neg_get_batch_proposal_wrong_state` | n/a |
| `contract-upgrade` | `get_proposal_count` | `neg_get_proposal_count_unauthorized` | `neg_get_proposal_count_wrong_state` | n/a |
| `contract-upgrade` | `get_approved_by` | `neg_get_approved_by_unauthorized` | `neg_get_approved_by_wrong_state` | n/a |
| `contract-upgrade` | `get_admin` | `neg_get_admin_unauthorized` | `neg_get_admin_wrong_state` | n/a |
| `contract-upgrade` | `get_rollback_wasm_hash` | `neg_get_rollback_wasm_hash_unauthorized` | `neg_get_rollback_wasm_hash_wrong_state` | n/a |
| `contract-upgrade` | `is_rollback_available` | `neg_is_rollback_available_unauthorized` | `neg_is_rollback_available_wrong_state` | n/a |
| `escrow` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | required |
| `escrow` | `create_escrow` | `neg_create_escrow_unauthorized` | `neg_create_escrow_wrong_state` | required |
| `escrow` | `deposit` | `neg_deposit_unauthorized` | `neg_deposit_wrong_state` | required |
| `escrow` | `approve_release` | `neg_approve_release_unauthorized` | `neg_approve_release_wrong_state` | required |
| `escrow` | `release` | `neg_release_unauthorized` | `neg_release_wrong_state` | required |
| `escrow` | `refund` | `neg_refund_unauthorized` | `neg_refund_wrong_state` | required |
| `escrow` | `raise_dispute` | `neg_raise_dispute_unauthorized` | `neg_raise_dispute_wrong_state` | required |
| `escrow` | `resolve_dispute` | `neg_resolve_dispute_unauthorized` | `neg_resolve_dispute_wrong_state` | required |
| `escrow` | `get_escrow` | `neg_get_escrow_unauthorized` | `neg_get_escrow_wrong_state` | required |
| `escrow` | `get_escrow_count` | `neg_get_escrow_count_unauthorized` | `neg_get_escrow_count_wrong_state` | required |
| `escrow` | `is_refundable` | `neg_is_refundable_unauthorized` | `neg_is_refundable_wrong_state` | required |
| `escrow` | `is_releasable` | `neg_is_releasable_unauthorized` | `neg_is_releasable_wrong_state` | required |
| `fee-collector` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `fee-collector` | `deposit` | `neg_deposit_unauthorized` | `neg_deposit_wrong_state` | n/a |
| `fee-collector` | `accrue` | `neg_accrue_unauthorized` | `neg_accrue_wrong_state` | n/a |
| `fee-collector` | `request_withdrawal` | `neg_request_withdrawal_unauthorized` | `neg_request_withdrawal_wrong_state` | n/a |
| `fee-collector` | `execute_withdrawal` | `neg_execute_withdrawal_unauthorized` | `neg_execute_withdrawal_wrong_state` | n/a |
| `fee-collector` | `get_balance` | `neg_get_balance_unauthorized` | `neg_get_balance_wrong_state` | n/a |
| `fee-collector` | `get_withdrawal` | `neg_get_withdrawal_unauthorized` | `neg_get_withdrawal_wrong_state` | n/a |
| `fee-collector` | `get_guardians` | `neg_get_guardians_unauthorized` | `neg_get_guardians_wrong_state` | n/a |
| `fee-collector` | `get_guardian_count` | `neg_get_guardian_count_unauthorized` | `neg_get_guardian_count_wrong_state` | n/a |
| `fee-collector` | `set_guardians` | `neg_set_guardians_unauthorized` | `neg_set_guardians_wrong_state` | n/a |
| `fee-collector` | `set_timelock` | `neg_set_timelock_unauthorized` | `neg_set_timelock_wrong_state` | n/a |
| `fee-collector` | `get_timelock` | `neg_get_timelock_unauthorized` | `neg_get_timelock_wrong_state` | n/a |
| `fx-oracle` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `fx-oracle` | `get_admin` | `neg_get_admin_unauthorized` | `neg_get_admin_wrong_state` | n/a |
| `fx-oracle` | `is_paused` | `neg_is_paused_unauthorized` | `neg_is_paused_wrong_state` | n/a |
| `fx-oracle` | `set_paused` | `neg_set_paused_unauthorized` | `neg_set_paused_wrong_state` | n/a |
| `fx-oracle` | `add_signer` | `neg_add_signer_unauthorized` | `neg_add_signer_wrong_state` | n/a |
| `fx-oracle` | `remove_signer` | `neg_remove_signer_unauthorized` | `neg_remove_signer_wrong_state` | n/a |
| `fx-oracle` | `is_signer` | `neg_is_signer_unauthorized` | `neg_is_signer_wrong_state` | n/a |
| `fx-oracle` | `get_signers` | `neg_get_signers_unauthorized` | `neg_get_signers_wrong_state` | n/a |
| `fx-oracle` | `set_staleness_bound` | `neg_set_staleness_bound_unauthorized` | `neg_set_staleness_bound_wrong_state` | n/a |
| `fx-oracle` | `get_staleness_bound` | `neg_get_staleness_bound_unauthorized` | `neg_get_staleness_bound_wrong_state` | n/a |
| `fx-oracle` | `update_rate` | `neg_update_rate_unauthorized` | `neg_update_rate_wrong_state` | n/a |
| `fx-oracle` | `get_rate` | `neg_get_rate_unauthorized` | `neg_get_rate_wrong_state` | n/a |
| `fx-oracle` | `validate_rate` | `neg_validate_rate_unauthorized` | `neg_validate_rate_wrong_state` | n/a |
| `fx-oracle` | `convert` | `neg_convert_unauthorized` | `neg_convert_wrong_state` | n/a |
| `guardian` | `initialize` | `neg_initialize_unauthorized` | `neg_initialize_wrong_state` | n/a |
| `guardian` | `register_contract` | `neg_register_contract_unauthorized` | `neg_register_contract_wrong_state` | n/a |
| `guardian` | `unregister_contract` | `neg_unregister_contract_unauthorized` | `neg_unregister_contract_wrong_state` | n/a |
| `guardian` | `emergency_pause_all` | `neg_emergency_pause_all_unauthorized` | `neg_emergency_pause_all_wrong_state` | n/a |
| `guardian` | `emergency_unpause_all` | `neg_emergency_unpause_all_unauthorized` | `neg_emergency_unpause_all_wrong_state` | n/a |
| `guardian` | `get_guardian` | `neg_get_guardian_unauthorized` | `neg_get_guardian_wrong_state` | n/a |
| `guardian` | `get_registered_contracts` | `neg_get_registered_contracts_unauthorized` | `neg_get_registered_contracts_wrong_state` | n/a |
| `guardian` | `get_contract_count` | `neg_get_contract_count_unauthorized` | `neg_get_contract_count_wrong_state` | n/a |
| `guardian` | `is_contract_registered` | `neg_is_contract_registered_unauthorized` | `neg_is_contract_registered_wrong_state` | n/a |
| `loyalty_rewards` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `loyalty_rewards` | `set_paused` | `neg_set_paused_unauthorized` | `neg_set_paused_wrong_state` | n/a |
| `loyalty_rewards` | `set_renewal_caller` | `neg_set_renewal_caller_unauthorized` | `neg_set_renewal_caller_wrong_state` | n/a |
| `loyalty_rewards` | `accrue` | `neg_accrue_unauthorized` | `neg_accrue_wrong_state` | n/a |
| `loyalty_rewards` | `miss` | `neg_miss_unauthorized` | `neg_miss_wrong_state` | n/a |
| `loyalty_rewards` | `redeem` | `neg_redeem_unauthorized` | `neg_redeem_wrong_state` | n/a |
| `loyalty_rewards` | `balance` | `neg_balance_unauthorized` | `neg_balance_wrong_state` | n/a |
| `loyalty_rewards` | `account` | `neg_account_unauthorized` | `neg_account_wrong_state` | n/a |
| `loyalty_rewards` | `streak` | `neg_streak_unauthorized` | `neg_streak_wrong_state` | n/a |
| `loyalty_rewards` | `is_paused` | `neg_is_paused_unauthorized` | `neg_is_paused_wrong_state` | n/a |
| `payment-adapter` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | required |
| `payment-adapter` | `allow_token` | `neg_allow_token_unauthorized` | `neg_allow_token_wrong_state` | required |
| `payment-adapter` | `revoke_token` | `neg_revoke_token_unauthorized` | `neg_revoke_token_wrong_state` | required |
| `payment-adapter` | `settle_renewal` | `neg_settle_renewal_unauthorized` | `neg_settle_renewal_wrong_state` | required |
| `payment-adapter` | `get_policy` | `neg_get_policy_unauthorized` | `neg_get_policy_wrong_state` | required |
| `payment-adapter` | `available` | `neg_available_unauthorized` | `neg_available_wrong_state` | required |
| `payment-adapter` | `is_allowed` | `neg_is_allowed_unauthorized` | `neg_is_allowed_wrong_state` | required |
| `payment-channel` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | required |
| `payment-channel` | `open_channel` | `neg_open_channel_unauthorized` | `neg_open_channel_wrong_state` | required |
| `payment-channel` | `submit_state` | `neg_submit_state_unauthorized` | `neg_submit_state_wrong_state` | required |
| `payment-channel` | `initiate_close` | `neg_initiate_close_unauthorized` | `neg_initiate_close_wrong_state` | required |
| `payment-channel` | `dispute` | `neg_dispute_unauthorized` | `neg_dispute_wrong_state` | required |
| `payment-channel` | `finalize` | `neg_finalize_unauthorized` | `neg_finalize_wrong_state` | required |
| `payment-channel` | `top_up` | `neg_top_up_unauthorized` | `neg_top_up_wrong_state` | required |
| `payment-channel` | `get_channel` | `neg_get_channel_unauthorized` | `neg_get_channel_wrong_state` | required |
| `payment-channel` | `register_watchtower` | `neg_register_watchtower_unauthorized` | `neg_register_watchtower_wrong_state` | required |
| `payment-channel` | `deregister_watchtower` | `neg_deregister_watchtower_unauthorized` | `neg_deregister_watchtower_wrong_state` | required |
| `payment-channel` | `get_watchtowers` | `neg_get_watchtowers_unauthorized` | `neg_get_watchtowers_wrong_state` | required |
| `payment-channel` | `get_watchtower_bounty` | `neg_get_watchtower_bounty_unauthorized` | `neg_get_watchtower_bounty_wrong_state` | required |
| `payment-channel` | `watchtower_submit` | `neg_watchtower_submit_unauthorized` | `neg_watchtower_submit_wrong_state` | required |
| `payment-splitter` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | required |
| `payment-splitter` | `configure_split` | `neg_configure_split_unauthorized` | `neg_configure_split_wrong_state` | required |
| `payment-splitter` | `execute_split` | `neg_execute_split_unauthorized` | `neg_execute_split_wrong_state` | required |
| `payment-splitter` | `cancel_split` | `neg_cancel_split_unauthorized` | `neg_cancel_split_wrong_state` | required |
| `payment-splitter` | `get_split` | `neg_get_split_unauthorized` | `neg_get_split_wrong_state` | required |
| `payment-splitter` | `split_count` | `neg_split_count_unauthorized` | `neg_split_count_wrong_state` | required |
| `payment-splitter` | `admin` | `neg_admin_unauthorized` | `neg_admin_wrong_state` | required |
| `recurring_allowance` | `grant_allowance` | `neg_grant_allowance_unauthorized` | `neg_grant_allowance_wrong_state` | required |
| `recurring_allowance` | `revoke_allowance` | `neg_revoke_allowance_unauthorized` | `neg_revoke_allowance_wrong_state` | required |
| `recurring_allowance` | `consume_allowance` | `neg_consume_allowance_unauthorized` | `neg_consume_allowance_wrong_state` | required |
| `recurring_allowance` | `update_allowance` | `neg_update_allowance_unauthorized` | `neg_update_allowance_wrong_state` | required |
| `recurring_allowance` | `get_allowance` | `neg_get_allowance_unauthorized` | `neg_get_allowance_wrong_state` | required |
| `recurring_allowance` | `get_remaining_period_allowance` | `neg_get_remaining_period_allowance_unauthorized` | `neg_get_remaining_period_allowance_wrong_state` | required |
| `recurring_allowance` | `get_remaining_absolute_allowance` | `neg_get_remaining_absolute_allowance_unauthorized` | `neg_get_remaining_absolute_allowance_wrong_state` | required |
| `resolver-registry` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `resolver-registry` | `add_arbiter` | `neg_add_arbiter_unauthorized` | `neg_add_arbiter_wrong_state` | n/a |
| `resolver-registry` | `remove_arbiter` | `neg_remove_arbiter_unauthorized` | `neg_remove_arbiter_wrong_state` | n/a |
| `resolver-registry` | `set_quorum` | `neg_set_quorum_unauthorized` | `neg_set_quorum_wrong_state` | n/a |
| `resolver-registry` | `open_case` | `neg_open_case_unauthorized` | `neg_open_case_wrong_state` | n/a |
| `resolver-registry` | `vote` | `neg_vote_unauthorized` | `neg_vote_wrong_state` | n/a |
| `resolver-registry` | `get_case` | `neg_get_case_unauthorized` | `neg_get_case_wrong_state` | n/a |
| `resolver-registry` | `get_case_count` | `neg_get_case_count_unauthorized` | `neg_get_case_count_wrong_state` | n/a |
| `resolver-registry` | `get_quorum` | `neg_get_quorum_unauthorized` | `neg_get_quorum_wrong_state` | n/a |
| `resolver-registry` | `get_arbiters` | `neg_get_arbiters_unauthorized` | `neg_get_arbiters_wrong_state` | n/a |
| `resolver-registry` | `is_arbiter` | `neg_is_arbiter_unauthorized` | `neg_is_arbiter_wrong_state` | n/a |
| `resolver-registry` | `get_vote` | `neg_get_vote_unauthorized` | `neg_get_vote_wrong_state` | n/a |
| `stealth-announcement` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `stealth-announcement` | `get_admin` | `neg_get_admin_unauthorized` | `neg_get_admin_wrong_state` | n/a |
| `stealth-announcement` | `publish` | `neg_publish_unauthorized` | `neg_publish_wrong_state` | n/a |
| `stealth-announcement` | `get_announcement` | `neg_get_announcement_unauthorized` | `neg_get_announcement_wrong_state` | n/a |
| `stealth-announcement` | `get_announcement_count` | `neg_get_announcement_count_unauthorized` | `neg_get_announcement_count_wrong_state` | n/a |
| `stealth-announcement` | `get_announcements_range` | `neg_get_announcements_range_unauthorized` | `neg_get_announcements_range_wrong_state` | n/a |
| `stealth-announcement` | `get_latest_announcements` | `neg_get_latest_announcements_unauthorized` | `neg_get_latest_announcements_wrong_state` | n/a |
| `subscription_logging` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `subscription_logging` | `record_log` | `neg_record_log_unauthorized` | `neg_record_log_wrong_state` | n/a |
| `subscription_logging` | `get_logs` | `neg_get_logs_unauthorized` | `neg_get_logs_wrong_state` | n/a |
| `subscription_logging` | `record_commitment` | `neg_record_commitment_unauthorized` | `neg_record_commitment_wrong_state` | n/a |
| `subscription_logging` | `get_commitment` | `neg_get_commitment_unauthorized` | `neg_get_commitment_wrong_state` | n/a |
| `subscription_logging` | `get_commitment_count` | `neg_get_commitment_count_unauthorized` | `neg_get_commitment_count_wrong_state` | n/a |
| `subscription_logging` | `get_commitments_range` | `neg_get_commitments_range_unauthorized` | `neg_get_commitments_range_wrong_state` | n/a |
| `subscription_logging` | `anchor_merkle_root` | `neg_anchor_merkle_root_unauthorized` | `neg_anchor_merkle_root_wrong_state` | n/a |
| `subscription_logging` | `get_merkle_root` | `neg_get_merkle_root_unauthorized` | `neg_get_merkle_root_wrong_state` | n/a |
| `subscription_logging` | `get_merkle_root_count` | `neg_get_merkle_root_count_unauthorized` | `neg_get_merkle_root_count_wrong_state` | n/a |
| `subscription_logging` | `verify_merkle_membership` | `neg_verify_merkle_membership_unauthorized` | `neg_verify_merkle_membership_wrong_state` | n/a |
| `subscription_nft` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `subscription_nft` | `set_paused` | `neg_set_paused_unauthorized` | `neg_set_paused_wrong_state` | n/a |
| `subscription_nft` | `set_mint_authority` | `neg_set_mint_authority_unauthorized` | `neg_set_mint_authority_wrong_state` | n/a |
| `subscription_nft` | `mint` | `neg_mint_unauthorized` | `neg_mint_wrong_state` | n/a |
| `subscription_nft` | `transfer` | `neg_transfer_unauthorized` | `neg_transfer_wrong_state` | n/a |
| `subscription_nft` | `approve` | `neg_approve_unauthorized` | `neg_approve_wrong_state` | n/a |
| `subscription_nft` | `revoke_approval` | `neg_revoke_approval_unauthorized` | `neg_revoke_approval_wrong_state` | n/a |
| `subscription_nft` | `burn` | `neg_burn_unauthorized` | `neg_burn_wrong_state` | n/a |
| `subscription_nft` | `update_renewal_state` | `neg_update_renewal_state_unauthorized` | `neg_update_renewal_state_wrong_state` | n/a |
| `subscription_nft` | `get_token` | `neg_get_token_unauthorized` | `neg_get_token_wrong_state` | n/a |
| `subscription_nft` | `owner_of` | `neg_owner_of_unauthorized` | `neg_owner_of_wrong_state` | n/a |
| `subscription_nft` | `balance_of` | `neg_balance_of_unauthorized` | `neg_balance_of_wrong_state` | n/a |
| `subscription_nft` | `get_approval` | `neg_get_approval_unauthorized` | `neg_get_approval_wrong_state` | n/a |
| `subscription_nft` | `token_for_sub` | `neg_token_for_sub_unauthorized` | `neg_token_for_sub_wrong_state` | n/a |
| `subscription_nft` | `total_minted` | `neg_total_minted_unauthorized` | `neg_total_minted_wrong_state` | n/a |
| `subscription_nft` | `is_paused` | `neg_is_paused_unauthorized` | `neg_is_paused_wrong_state` | n/a |
| `subscription_refund` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | required |
| `subscription_refund` | `record_charge` | `neg_record_charge_unauthorized` | `neg_record_charge_wrong_state` | required |
| `subscription_refund` | `open_dispute` | `neg_open_dispute_unauthorized` | `neg_open_dispute_wrong_state` | required |
| `subscription_refund` | `authorize_dispute` | `neg_authorize_dispute_unauthorized` | `neg_authorize_dispute_wrong_state` | required |
| `subscription_refund` | `process_refund` | `neg_process_refund_unauthorized` | `neg_process_refund_wrong_state` | required |
| `subscription_refund` | `is_refunded` | `neg_is_refunded_unauthorized` | `neg_is_refunded_wrong_state` | required |
| `subscription_refund` | `get_charge` | `neg_get_charge_unauthorized` | `neg_get_charge_wrong_state` | required |
| `subscription_refund` | `get_dispute` | `neg_get_dispute_unauthorized` | `neg_get_dispute_wrong_state` | required |
| `subscription_refund` | `set_admin` | `neg_set_admin_unauthorized` | `neg_set_admin_wrong_state` | required |
| `subscription_refund` | `set_dispute_admin` | `neg_set_dispute_admin_unauthorized` | `neg_set_dispute_admin_wrong_state` | required |
| `subscription_refund` | `set_paused` | `neg_set_paused_unauthorized` | `neg_set_paused_wrong_state` | required |
| `subscription_renewal` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | required |
| `subscription_renewal` | `set_paused` | `neg_set_paused_unauthorized` | `neg_set_paused_wrong_state` | required |
| `subscription_renewal` | `is_paused` | `neg_is_paused_unauthorized` | `neg_is_paused_wrong_state` | required |
| `subscription_renewal` | `set_logging_contract` | `neg_set_logging_contract_unauthorized` | `neg_set_logging_contract_wrong_state` | required |
| `subscription_renewal` | `set_token_contract` | `neg_set_token_contract_unauthorized` | `neg_set_token_contract_wrong_state` | required |
| `subscription_renewal` | `get_token_contract` | `neg_get_token_contract_unauthorized` | `neg_get_token_contract_wrong_state` | required |
| `subscription_renewal` | `acquire_renewal_lock` | `neg_acquire_renewal_lock_unauthorized` | `neg_acquire_renewal_lock_wrong_state` | required |
| `subscription_renewal` | `release_renewal_lock` | `neg_release_renewal_lock_unauthorized` | `neg_release_renewal_lock_wrong_state` | required |
| `subscription_renewal` | `get_renewal_lock` | `neg_get_renewal_lock_unauthorized` | `neg_get_renewal_lock_wrong_state` | required |
| `subscription_renewal` | `init_sub` | `neg_init_sub_unauthorized` | `neg_init_sub_wrong_state` | required |
| `subscription_renewal` | `cancel_sub` | `neg_cancel_sub_unauthorized` | `neg_cancel_sub_wrong_state` | required |
| `subscription_renewal` | `approve_renewal` | `neg_approve_renewal_unauthorized` | `neg_approve_renewal_wrong_state` | required |
| `subscription_renewal` | `renew` | `neg_renew_unauthorized` | `neg_renew_wrong_state` | required |
| `subscription_renewal` | `get_escrow_balance` | `neg_get_escrow_balance_unauthorized` | `neg_get_escrow_balance_wrong_state` | required |
| `subscription_renewal` | `claim_escrow` | `neg_claim_escrow_unauthorized` | `neg_claim_escrow_wrong_state` | required |
| `subscription_renewal` | `get_sub` | `neg_get_sub_unauthorized` | `neg_get_sub_wrong_state` | required |
| `subscription_renewal` | `get_lifecycle` | `neg_get_lifecycle_unauthorized` | `neg_get_lifecycle_wrong_state` | required |
| `subscription_renewal` | `set_window` | `neg_set_window_unauthorized` | `neg_set_window_wrong_state` | required |
| `subscription_renewal` | `get_window` | `neg_get_window_unauthorized` | `neg_get_window_wrong_state` | required |
| `subscription_renewal` | `set_user_cap` | `neg_set_user_cap_unauthorized` | `neg_set_user_cap_wrong_state` | required |
| `subscription_renewal` | `get_user_cap` | `neg_get_user_cap_unauthorized` | `neg_get_user_cap_wrong_state` | required |
| `subscription_renewal` | `get_user_spent` | `neg_get_user_spent_unauthorized` | `neg_get_user_spent_wrong_state` | required |
| `subscription_renewal` | `set_team_threshold` | `neg_set_team_threshold_unauthorized` | `neg_set_team_threshold_wrong_state` | required |
| `subscription_renewal` | `get_team_threshold` | `neg_get_team_threshold_unauthorized` | `neg_get_team_threshold_wrong_state` | required |
| `subscription_renewal` | `set_signing_window` | `neg_set_signing_window_unauthorized` | `neg_set_signing_window_wrong_state` | required |
| `subscription_renewal` | `get_signing_window` | `neg_get_signing_window_unauthorized` | `neg_get_signing_window_wrong_state` | required |
| `subscription_renewal` | `request_multisig_renewal` | `neg_request_multisig_renewal_unauthorized` | `neg_request_multisig_renewal_wrong_state` | required |
| `subscription_renewal` | `sign_multisig_renewal` | `neg_sign_multisig_renewal_unauthorized` | `neg_sign_multisig_renewal_wrong_state` | required |
| `subscription_renewal` | `cancel_multisig_renewal` | `neg_cancel_multisig_renewal_unauthorized` | `neg_cancel_multisig_renewal_wrong_state` | required |
| `subscription_renewal` | `expire_multisig_renewal` | `neg_expire_multisig_renewal_unauthorized` | `neg_expire_multisig_renewal_wrong_state` | required |
| `subscription_renewal` | `get_multisig_request` | `neg_get_multisig_request_unauthorized` | `neg_get_multisig_request_wrong_state` | required |
| `subscription_renewal` | `requires_multisig` | `neg_requires_multisig_unauthorized` | `neg_requires_multisig_wrong_state` | required |
| `virtual-card` | `issue_card` | `neg_issue_card_unauthorized` | `neg_issue_card_wrong_state` | n/a |
| `virtual-card` | `process_payment` | `neg_process_payment_unauthorized` | `neg_process_payment_wrong_state` | n/a |
| `virtual-card` | `get_balance` | `neg_get_balance_unauthorized` | `neg_get_balance_wrong_state` | n/a |
| `virtual-card` | `get_card` | `neg_get_card_unauthorized` | `neg_get_card_wrong_state` | n/a |
| `virtual-card` | `activate_card` | `neg_activate_card_unauthorized` | `neg_activate_card_wrong_state` | n/a |
| `virtual-card` | `deactivate_card` | `neg_deactivate_card_unauthorized` | `neg_deactivate_card_wrong_state` | n/a |
| `virtual-card` | `suspend_card` | `neg_suspend_card_unauthorized` | `neg_suspend_card_wrong_state` | n/a |
| `virtual-card` | `verify_ownership` | `neg_verify_ownership_unauthorized` | `neg_verify_ownership_wrong_state` | n/a |
| `virtual-card` | `can_transact` | `neg_can_transact_unauthorized` | `neg_can_transact_wrong_state` | n/a |
| `virtual-card` | `version` | `neg_version_unauthorized` | `neg_version_wrong_state` | n/a |
| `voucher-ledger` | `init` | `neg_init_unauthorized` | `neg_init_wrong_state` | n/a |
| `voucher-ledger` | `mint_voucher` | `neg_mint_voucher_unauthorized` | `neg_mint_voucher_wrong_state` | n/a |
| `voucher-ledger` | `redeem_voucher` | `neg_redeem_voucher_unauthorized` | `neg_redeem_voucher_wrong_state` | n/a |
| `voucher-ledger` | `void_voucher` | `neg_void_voucher_unauthorized` | `neg_void_voucher_wrong_state` | n/a |
| `voucher-ledger` | `get_voucher` | `neg_get_voucher_unauthorized` | `neg_get_voucher_wrong_state` | n/a |
| `voucher-ledger` | `balance` | `neg_balance_unauthorized` | `neg_balance_wrong_state` | n/a |
| `voucher-ledger` | `is_active` | `neg_is_active_unauthorized` | `neg_is_active_wrong_state` | n/a |
| `zk-payment-verifier` | `verify_and_record` | `neg_verify_and_record_unauthorized` | `neg_verify_and_record_wrong_state` | n/a |
| `zk-payment-verifier` | `is_nullifier_used` | `neg_is_nullifier_used_unauthorized` | `neg_is_nullifier_used_wrong_state` | n/a |

<!-- END NEGATIVE-PATH-MATRIX -->
