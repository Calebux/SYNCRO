# ADR-011: Direct Token Transfer for Recurring Subscription Renewals

**Status:** Superseded by [ADR-005](./ADR-005-payment-channels-for-renewals.md)  
**Date:** 2026-05-25  
**Deciders:** Early Prototype Working Group  
**Issue/PR:** Prototype Architecture  

---

## Context

In early proof-of-concept iterations of SYNCRO, subscription renewals were triggered by initiating a direct Stellar token payment (`payment` operation) from the subscriber's address to the merchant's address upon every billing cycle.

---

## Decision

The initial prototype used **Direct Synchronous Token Transfer**:
- Subscriber signed a transfer transaction at the time of renewal.
- Payments moved funds directly from user account to merchant account without intermediate contract state.

---

## Reason for Superseding

Direct token transfer proved unviable for production subscription billing because:
1. **User Presence Requirement**: The subscriber had to connect their wallet and sign a transaction live during every renewal cycle, failing the primary user expectation of passive recurring billing.
2. **No Execution Authorization**: Automated background workers had no authority to execute payments without holding user private keys (violating non-custodial design).
3. **No Cap or Window Controls**: Direct transfers lacked on-chain rate limits, spending caps, or time-window guardrails.

This approach was replaced by **Payment Channels & Pre-Authorized Execution Windows** in [ADR-005](./ADR-005-payment-channels-for-renewals.md).

---

## Consequences

### Positive (Historical)
- Simplest possible Stellar transaction model for early testnet experiments.

### Negative
- Required manual user interaction for every renewal.
- Impossible to execute scheduled background renewal jobs.
