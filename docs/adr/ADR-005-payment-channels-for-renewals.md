# ADR-005: Payment Channels & Pre-Authorized Execution Windows for Renewals

**Status:** Accepted (Retrospective)  
**Date:** 2026-06-01  
**Deciders:** Smart Contract & Backend Architecture Teams  
**Issue/PR:** #605  
**Supersedes:** [ADR-011](./ADR-011-direct-token-transfer-renewals.md)  

---

## Context

Automating recurring subscription payments on a blockchain presents a fundamental trust conflict:
1. **User UX Expectation**: Subscriptions should renew automatically on schedule without requiring the user to manually connect their wallet and sign a transaction every billing cycle.
2. **Non-Custodial Guarantee**: SYNCRO must never hold or store user private keys on backend servers.
3. **Overbilling Protection**: Merchants or execution bots must not be allowed to drain user funds beyond the agreed recurring subscription amount and schedule.

Earlier prototypes relied on direct token transfers (`ADR-011`), which required users to be online to sign each payment. To eliminate this limitation while maintaining non-custodial security, a pre-authorized execution framework was required.

---

## Decision

We implemented **Payment Channels with Pre-Authorized Execution Windows** in the `SubscriptionRenewal` Soroban smart contract.

- **Pre-Approved Allowances**: Users sign a single-use approval (`approve_renewal()`) specifying:
  - `max_spend`: Maximum token amount for the cycle.
  - `expires_at`: Expiry ledger sequence.
  - `billing_start` & `billing_end`: Time window when renewal is valid.
- **Execution Agents**: Authorized backend worker bots (`AgentRegistry`) execute renewals on behalf of users within the valid window.
- **Single-Use Consumption**: Approvals are marked as consumed upon execution, preventing double-billing or replay attacks.
- **Concurrency Locks**: Execution agents acquire a processing lock (`acquire_renewal_lock()`) to prevent race conditions across parallel workers.

---

## Consequences

### Positive
- **Passive Automation**: Subscriptions renew automatically while the user is offline.
- **Strict Non-Custodial Bounds**: Backend agents cannot pull funds outside pre-approved spend limits or expired time windows.
- **Replay & Overcharge Protection**: Single-use approval IDs enforce exact billing amounts and frequencies.

### Negative
- **Approval Window Maintenance**: Client software or agents must pre-generate valid approvals prior to each billing window.
- **State Complexity**: Contracts must track state transitions (`Active`, `Retrying`, `Failed`, `Cancelled`), lock timeouts, and cooldown ledgers.

### Neutral
- Protocol fees are configurable by admin (`set_fee_config()`) and subtracted during settlement.

---

## Compliance & Verification

- Soroban contract functions `init_sub`, `approve_renewal`, `acquire_renewal_lock`, and `renew` in `contracts/subscription_renewal/` enforce window checks.
- Verification tests in `contracts/` test suite confirm that expired or over-budget renewals fail deterministically.
