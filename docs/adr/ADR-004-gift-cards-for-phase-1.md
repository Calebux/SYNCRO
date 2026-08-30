# ADR-004: Prepaid Crypto Gift Cards for Phase 1 Onboarding & Payments

**Status:** Accepted (Retrospective)  
**Date:** 2026-05-30  
**Deciders:** Product & Engineering Leadership  
**Issue/PR:** #494  

---

## Context

User onboarding friction is a critical challenge for Web3 subscription platforms. In Phase 1, requiring new users to immediately connect a crypto wallet funded with XLM/USDC or complete fiat KYC payment forms creates significant conversion drop-off.

Key challenges evaluated:
- **Traditional Payment Gateways**: Credit card processors (Stripe/PayPal) require complex merchant onboarding, chargeback management, and fixed per-transaction percentage fees.
- **Direct Crypto Wallet Requirement**: Users without existing Stellar wallet balances cannot pay for subscriptions without purchasing crypto on an exchange first.
- **Prepaid Voucher Demand**: Users and merchants requested a frictionless, voucher-style prepaid mechanism where value can be gifted or purchased upfront and redeemed seamlessly.

---

## Decision

We chose **Prepaid Crypto Gift Cards** as the primary onboarding and payment balance mechanism for **Phase 1**.

- **Gift Card Model**: Secure alphanumeric claim codes containing encrypted balance values.
- **Redemption Flow**: Users redeem codes to fund their SYNCRO subscription balance instantly without requiring initial on-chain gas setup.
- **Ledger Verification**: Gift card balance updates, redemptions, and adjustments are processed through an immutable double-entry ledger.

---

## Consequences

### Positive
- **Frictionless Onboarding**: New users can redeem gift card codes instantly and start tracking/paying for subscriptions.
- **No Initial Wallet Requirement**: Allows users to interact with SYNCRO before setting up advanced Web3 wallet credentials.
- **Corporate & Promotional Use**: Enables bulk gifting, promotional campaign vouchers, and enterprise team provisioning.

### Negative
- **Fraud & Collision Risk**: Claim codes require strong cryptographic randomness and rate-limited redemption checks to prevent brute-forcing.
- **Financial Tracking Complexity**: Requires a strict double-entry ledger service (`backend/src/services/gift-card-ledger-service.ts`) to prevent balance duplication or double-redemption.

### Neutral
- Phase 2 expands payment options to include native Stellar payment channels and virtual cards alongside gift cards.

---

## Compliance & Verification

- Gift card codes use cryptographically secure random generation (minimum 128-bit entropy).
- Redemption tests in `backend/tests/gift-card-ledger-service.test.ts` verify atomic double-entry ledger entries.
