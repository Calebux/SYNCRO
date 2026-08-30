# ADR-006: Arbiter-Mediated Escrow Contracts for High-Value Subscriptions

**Status:** Accepted (Retrospective)  
**Date:** 2026-06-03  
**Deciders:** Smart Contract & Security Teams  
**Issue/PR:** #659  

---

## Context

For enterprise SaaS subscriptions, customized tier agreements, or high-value service plans, direct token transfers between buyer (subscriber) and seller (merchant) expose both parties to risk:
- **Subscriber Risk**: Merchant collects payment upfront but fails to deliver service, uptime SLAs, or promised features.
- **Merchant Risk**: Subscriber uses the service but cancels or defaults prior to settlement.
- **Dispute Resolution Deficit**: Standard direct blockchain transfers are irreversible and lack a native arbitration mechanism.

---

## Decision

We designed and implemented a dedicated **Escrow Contract (`Escrow.rs`)** on Soroban to hold funds in escrow for high-value subscription agreements.

- **Escrow Creation**: Payer deposits subscription funds into the contract, designating a payee, an independent arbiter, token asset, amount, and expiration timestamp.
- **Funding & Release**:
  - `deposit()` locks funds in contract balance.
  - `approve_release()` records arbiter or multi-signature signoff.
  - `release()` transfers funds to payee upon service completion.
- **Refund & Dispute Workflow**:
  - `refund()` allows payer to reclaim unreleased funds after contract expiry.
  - `raise_dispute()` freezes release and escalates to designated arbiter.
  - `resolve_dispute()` permits arbiter to rule (1 = release to payee, 2 = refund to payer).

---

## Consequences

### Positive
- **Buyer & Seller Protection**: Guarantees funds exist while ensuring merchant delivers according to agreement.
- **Native Arbitration**: Multi-party dispute resolution handled trustlessly via on-chain contract logic.
- **Timeout Protection**: Unclaimed or inactive escrows automatically become refundable to payer after expiration.

### Negative
- **Capital Lockup**: Funds are locked in the smart contract until release, refund, or dispute resolution.
- **Arbiter Reliance**: Dispute resolution quality depends on the integrity and responsiveness of the designated arbiter address.

### Neutral
- Standard consumer micro-subscriptions use direct `SubscriptionRenewal` contracts; enterprise tiers opt into `Escrow` contracts.

---

## Compliance & Verification

- `contracts/escrow/` Rust implementation covers state machine validation (`Created`, `Funded`, `Approved`, `Disputed`, `Resolved`).
- Event logging (`EscrowCreated`, `EscrowFunded`, `EscrowDisputed`, `EscrowResolved`) provides full audit traceability.
