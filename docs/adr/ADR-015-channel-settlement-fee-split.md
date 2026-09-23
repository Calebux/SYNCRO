# ADR-015: Channel Settlement Fee Split Architecture

**Status:** Proposed  
**Date:** 2026-09-23  
**Deciders:** Smart Contract, Backend, and Finance Teams  
**Related Issues:** Channel Settlement Fee Separation  
**Related ADRs:** [ADR-005](./ADR-005-payment-channels-for-renewals.md), [ADR-006](./ADR-006-funds-in-escrow.md)

---

## Context

When a payment channel settles, accumulated `executorBalance` must be distributed between:
1. **Provider payout**: The service provider's earned revenue
2. **SYNCRO platform fee**: Platform commission for facilitating the payment channel

Currently, the fee structure exists (`PlatformFeeBps` in `SubscriptionRegistry`, `FeeCollector` contract) but **fee deduction timing and mechanism are undefined** at settlement. 

### Problem Statement

Deciding fee deduction **late in the settlement flow** creates several issues:

1. **Semantic Ambiguity**: Does `executorBalance` represent gross (pre-fee) or net (post-fee) provider revenue?
2. **Reconciliation Complexity**: Retrofitting fee splits into existing channel balance invariants is expensive and error-prone
3. **Receipt Transparency**: Fees hidden in spread calculations reduce trust and auditability
4. **Provider Payout Address Changes**: If a provider updates their payout address while channels are open, settlement logic must handle address routing correctly
5. **Rate Card Versioning**: Fee rates may change over time; settlement must use the correct historical rate

### Current State

- **Channel Balance Invariant**: `userBalance + executorBalance == totalDeposited`
- **Off-Chain Renewals**: Deduct from `userBalance`, add full amount to `executorBalance`
- **Settlement**: Batch processor submits `executorBalance` to blockchain, but **no fee split logic exists**
- **Fee Configuration**: Admin-configurable `PlatformFeeBps` in smart contract (e.g., 250 = 2.5%)

---

## Decision

We will implement a **three-way split at settlement time** with the following architecture:

### 1. Fee Model: Inside the Channel

**Decision**: The SYNCRO platform fee is **deducted from `executorBalance` during settlement**, not pre-deducted during off-chain renewals.

**Rationale**:
- **Simpler off-chain state**: Renewals remain atomic balance transfers without fee calculation logic
- **Channel invariant preserved**: `userBalance + executorBalance == totalDeposited` remains unchanged
- **Single settlement point**: Fee split happens once at settlement, not per-renewal
- **Easier auditing**: All fee deductions are recorded in settlement transactions, not scattered across renewal logs

### 2. Settlement Fee Split Formula

At settlement, `executorBalance` is divided into:

```typescript
const grossAmount = executorBalance;
const platformFee = Math.floor(grossAmount * platformFeeBps / 10_000);
const providerPayout = grossAmount - platformFee;

// Three-way split:
// 1. userBalance → returned to user (if any remaining)
// 2. platformFee → FeeCollector contract
// 3. providerPayout → provider's payout address
```

**Precision**: Fee calculations use **integer arithmetic** with floor rounding to avoid fractional token amounts.

### 3. Fee Rate Versioning

Fees are versioned per **provider agreement** and locked at channel open:

- **New Field**: `payment_channels.fee_rate_bps` (captured at channel creation)
- **Immutable**: Fee rate does not change for the lifetime of a channel
- **Rationale**: Prevents retroactive fee changes on existing open channels
- **Migration**: Existing channels default to current `PlatformFeeBps` value at migration time

### 4. Fee Transparency on Receipts

Settlement records must explicitly show fee breakdown:

```typescript
interface SettlementReceipt {
  channelId: string;
  settlementAmount: number;        // Gross executorBalance
  platformFee: number;              // SYNCRO fee deducted
  providerPayout: number;           // Net amount sent to provider
  feeRateBps: number;               // Fee rate used (e.g., 250)
  providerPayoutAddress: string;    // Final destination address
  transactionHash: string;          // On-chain TX proof
  settledAt: string;                // ISO 8601 timestamp
}
```

**Visibility**:
- Settlement receipts stored in `pending_settlements.metadata` (JSON column)
- Exposed via `GET /api/settlements/:id/receipt` API endpoint
- Displayed in provider dashboard and user transaction history

### 5. Provider Payout Address Changes

**Problem**: Provider updates their Stellar payout address while channels are still open.

**Solution**: 
- **New Table**: `provider_payout_addresses` with versioned history
  ```sql
  CREATE TABLE provider_payout_addresses (
    id UUID PRIMARY KEY,
    provider_id UUID NOT NULL,
    stellar_address VARCHAR(56) NOT NULL,
    effective_from TIMESTAMP NOT NULL,
    effective_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```
- **Settlement Logic**: Use `effective_from` timestamp to determine correct payout address at settlement time
- **Fallback**: If no versioned address found, use provider's current default address from `profiles.payout_address`

---

## Implementation Plan (3% Scope)

### Phase 1: Architecture Documentation (This ADR)
✅ **Status**: Complete
- Define fee split decision
- Document rate versioning approach
- Specify receipt transparency requirements
- Address provider payout address changes

### Phase 2: Database Schema (Future)
- Add `payment_channels.fee_rate_bps` column
- Create `provider_payout_addresses` table
- Add `pending_settlements.settlement_receipt` JSONB column
- Migration script to backfill existing channels with current `PlatformFeeBps`

### Phase 3: Smart Contract Updates (Future)
- Update `payment-channel::settle()` to accept `platformFeeAddress` parameter
- Emit `SettlementWithFee` event with split details
- Validate fee calculations on-chain

### Phase 4: Backend Settlement Logic (Future)
- Modify `settlementBatcher.submitBatch()` to calculate fee split
- Implement `GET /api/settlements/:id/receipt` endpoint
- Update provider dashboard to display net payouts

### Phase 5: Testing & Reconciliation (Future)
- Unit tests for fee calculation edge cases (rounding, zero fees, 100% fee)
- Integration test: full channel lifecycle with fee split
- Reconciliation script: validate `sum(providerPayout + platformFee) == executorBalance` across all settlements

---

## Consequences

### Positive

1. **Clear Semantics**: `executorBalance` always represents **gross provider revenue** (pre-fee)
2. **Transparent Fees**: Users and providers see explicit fee breakdowns on receipts
3. **Backward Compatible**: Existing off-chain renewal logic unchanged
4. **Versioned Rates**: Fee changes don't affect existing open channels
5. **Audit Trail**: All fee deductions recorded in settlement events and database
6. **Cent-Level Reconciliation**: Fee formula uses integer arithmetic; settlements reconcile exactly to metered usage

### Negative

1. **Settlement Complexity**: Settlement logic now requires fee calculation, provider address lookup, and multi-destination payout
2. **Gas Costs**: Three-way split (user refund + provider payout + fee collector) increases transaction cost slightly
3. **Historical Channels**: Channels opened before fee rate versioning must be backfilled with default rate

### Neutral

1. **Alternative Considered**: Pre-deducting fees during off-chain renewals would simplify settlement but complicate renewal logic and scatter fee audit trail
2. **Fee Collection Timing**: Fees accumulate in `FeeCollector` contract and require separate guardian withdrawal process (existing ADR-006 mechanism)

---

## Compliance & Verification

### Definition of Done

When this ADR is **fully implemented** (beyond 3% scope):

1. ✅ **Decision Documented**: ADR approved and merged (THIS DOCUMENT)
2. ⬜ **Split Implemented**: Settlement code deducts `platformFee` and sends to `FeeCollector`
3. ⬜ **Receipt Generated**: `GET /api/settlements/:id/receipt` returns structured fee breakdown
4. ⬜ **Reconciliation Passes**: 
   ```bash
   # Validation script confirms:
   for each settled_channel:
     assert providerPayout + platformFee == executorBalance
     assert abs(providerPayout - (metered_usage - fee)) < 0.01  # cent precision
   ```
5. ⬜ **Rate Versioning Active**: New channels capture `fee_rate_bps` at creation
6. ⬜ **Provider Address Handling**: Settlement correctly routes to versioned payout address

### Testing Scenarios

```typescript
// Test Case 1: Standard fee split
channelState = { executorBalance: 100_00, feeRateBps: 250 }
expected = { platformFee: 2_50, providerPayout: 97_50 }

// Test Case 2: Zero fee (promotional period)
channelState = { executorBalance: 100_00, feeRateBps: 0 }
expected = { platformFee: 0, providerPayout: 100_00 }

// Test Case 3: Rounding edge case
channelState = { executorBalance: 99, feeRateBps: 333 } // 3.33%
expected = { platformFee: 3, providerPayout: 96 }  // floor(99 * 333 / 10000) = 3

// Test Case 4: Provider address change
channel_opened = 2026-01-01
provider_address_change = 2026-06-01 (old_addr → new_addr)
settlement_date = 2026-09-23
expected = { payoutAddress: new_addr }  // Use address effective at settlement
```

---

## References

- **ADR-005**: Payment Channels & Pre-Authorized Execution (defines channel balance semantics)
- **ADR-006**: Arbiter-Mediated Escrow Contracts (defines `FeeCollector` guardian treasury)
- **Contract**: `fee-collector/src/lib.rs` (platform fee accumulation & withdrawal)
- **Contract**: `subscription_registry.rs` (`PlatformFeeBps` configuration)
- **Backend**: `settlement-batcher.ts` (settlement queue processor)
- **Backend**: `channel-settlement-job.ts` (periodic settlement trigger)
- **Database**: `pending_settlements` table (settlement queue)
- **Database**: `payment_channels` table (channel state & balances)

---

## Appendix: Fee Rate Configuration Examples

| Fee Rate (BPS) | Percentage | Example on $100 Revenue |
|----------------|------------|-------------------------|
| 0              | 0%         | Platform: $0, Provider: $100 |
| 100            | 1%         | Platform: $1, Provider: $99 |
| 250            | 2.5%       | Platform: $2.50, Provider: $97.50 |
| 500            | 5%         | Platform: $5, Provider: $95 |
| 1000           | 10%        | Platform: $10, Provider: $90 |

**Recommended Default**: 250 BPS (2.5%) for standard subscription channels
**Enterprise Tier**: 100 BPS (1%) for high-value channels (> $10k/month volume)
