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
│   ├── subscription_logging/    # On-chain audit trail logging contract
│   ├── subscription_renewal/    # Main subscription renewal logic contract
│   └── virtual-card/            # Non-custodial virtual card contract
├── scripts/                     # Deployment and initialization scripts
└── Cargo.toml                   # Cargo workspace configuration
```

## Current State (April 2026)

### ✅ Implemented
- **Core Contracts**: Functional renewal, escrow, and registry contracts.
- **On-chain Logging**: Structured audit trail for subscription events.
- **Stellar SDK 23**: Built on the latest Soroban stable release.
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

## Contract Development Roadmap

### Completed (MVP Stage)
- [x] On-chain subscription registry and tracking
- [x] Multi-agent renewal registry with scope controls
- [x] Secure escrow agreements with arbiter-mediated dispute resolution
- [x] Non-custodial virtual cards with disposable/auto-close behavior
- [x] On-chain audit logging system
- [x] Recurring allowance authority with per-period and absolute spending caps

### Phase 3: Mainnet Hardening
- [ ] Complete external security audits
- [ ] Gas optimization for complex loops (e.g. multi-agent authorizations)
- [ ] Integration with front-end SDKs

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
