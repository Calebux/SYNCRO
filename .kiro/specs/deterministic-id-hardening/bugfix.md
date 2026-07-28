# Bugfix Requirements Document

## Introduction

Several monotonic counters used to generate on-chain IDs lack overflow guards, and the
globally sequential nature of those counters creates a latent cross-tenant collision risk.
The affected identifiers are:

| ID | Contract / layer | Type | Risk |
|---|---|---|---|
| `escrow_id` | `contracts/escrow/src/lib.rs` | `u64` | Wrap at 2⁶⁴ (remote but unguarded) |
| `card_id` | `contracts/virtual-card/src/lib.rs` | `u32` | Wrap at ~4.3 billion (near-term concern) |
| `tx_id` (TxCounter) | `contracts/virtual-card/src/lib.rs` | `u32` | Same as card_id |
| `channel_id` | `contracts/payment-channel/src/lib.rs` | `u64` | Wrap at 2⁶⁴ (remote but unguarded) |
| `SubscriptionCounter` | `contracts/src/subscription_registry.rs` | `u64` | Wrap at 2⁶⁴ |
| `sequenceNumber` (off-chain) | `backend/src/services/payment-channel-service.ts` | JS `number` | Safe to 2⁵³ but unguarded |

Additionally, all counters except `SubscriptionCounter` are **globally sequential across
tenants** — there is no per-user namespace baked into the counter, so access control relies
entirely on address/RLS checks rather than on the ID structure itself.

The `sub_id` in `subscription_renewal` is caller-supplied and not validated for uniqueness
at the contract level, placing the uniqueness burden on callers.

---

## Bug Analysis

### Current Behavior (Defect)

**1.1 — No overflow guard on u32 `CardCounter`**
WHEN the `virtual-card` contract's `CardCounter` reaches `u32::MAX` (4,294,967,295) AND
`issue_card` is called THEN the counter silently wraps to 0 and a new card is assigned
`card_id = 1`, colliding with the first card ever issued and overwriting its storage entry.

**1.2 — No overflow guard on u32 `TxCounter`**
WHEN the `virtual-card` contract's `TxCounter` reaches `u32::MAX` AND `process_payment`
is called THEN the transaction counter wraps silently, and the returned `tx_id` aliases a
previous transaction's identifier, breaking audit integrity.

**1.3 — No overflow guard on u64 `EscrowCount`**
WHEN `EscrowCount` reaches `u64::MAX` AND `create_escrow` is called THEN the counter wraps
to 0, colliding `escrow_id = 1` with the original first escrow and potentially allowing a
new payer to overwrite an existing escrow storage entry.

**1.4 — No overflow guard on u64 `ChannelCount`**
WHEN `ChannelCount` reaches `u64::MAX` AND `open_channel` is called THEN the same silent
wrap occurs as in 1.3, overwriting the existing channel at id = 1.

**1.5 — No overflow guard on u64 `SubscriptionCounter`**
WHEN `SubscriptionCounter` reaches `u64::MAX` AND `create_subscription` is called THEN the
counter wraps, producing a subscription ID whose first 8 bytes are zero — potentially
colliding with the genesis subscription for that user.

**1.6 — Off-chain `sequenceNumber` is an unguarded JS `number`**
WHEN `applyOffChainRenewal` is called on a channel whose `sequenceNumber` has reached
`Number.MAX_SAFE_INTEGER` (2⁵³ − 1) THEN `sequenceNumber + 1` produces an incorrect
result due to IEEE 754 precision loss, silently corrupting channel state.

**1.7 — Globally sequential counters create cross-tenant collision surface**
WHEN all users share a single global counter AND that counter is the sole basis for an ID
THEN any future bug in access-control logic (contract or RLS) maps directly to a collision
between tenants' records. The escrow, card, channel, and tx counters all exhibit this.

**1.8 — `sub_id` uniqueness is caller-enforced, not contract-enforced**
WHEN the `subscription_renewal` contract receives an `init_sub` call with a `sub_id` that
already exists in persistent storage THEN the contract overwrites the existing subscription
data without error, because no uniqueness check is performed on entry.

---

### Expected Behavior (Correct)

**2.1 — `CardCounter` and `TxCounter` saturate at u32::MAX**
WHEN `issue_card` or `process_payment` is called AND the relevant counter equals `u32::MAX`
THEN the contract SHALL panic with a descriptive error (e.g., `CardLimitReached`,
`TxLimitReached`) before writing any new state, so no wrap and no collision occurs.

**2.2 — `EscrowCount` and `ChannelCount` saturate at u64::MAX**
WHEN `create_escrow` or `open_channel` is called AND the relevant counter equals `u64::MAX`
THEN the contract SHALL panic with a descriptive error before assigning a new ID, preventing
silent wraparound.

**2.3 — `SubscriptionCounter` saturates at u64::MAX**
WHEN `create_subscription` is called AND `SubscriptionCounter` equals `u64::MAX` THEN the
contract SHALL panic with `SubscriptionLimitReached` before generating a new ID.

**2.4 — Off-chain `sequenceNumber` guards against unsafe integer range**
WHEN `applyOffChainRenewal` is called AND the current `sequenceNumber >= Number.MAX_SAFE_INTEGER`
THEN the service SHALL throw a typed error (`SequenceOverflowError`) and refuse to apply the
state update, rather than silently producing a corrupted sequence number.

**2.5 — `card_id` u32 → u64 upgrade path is evaluated and documented**
WHEN the `virtual-card` contract is next upgraded THEN the engineering team SHALL have a
documented decision on whether to widen `card_id` from `u32` to `u64` (to align with
`escrow_id` and `channel_id`), including an analysis of on-chain storage impact and any
migration path for existing card records.

**2.6 — `sub_id` uniqueness enforced at the contract level**
WHEN `init_sub` is called with a `sub_id` that already exists in the contract's persistent
storage THEN the contract SHALL panic with `DuplicateSubscriptionId` rather than silently
overwriting the existing subscription record.

**2.7 — Overflow guards are covered by uniqueness tests**
WHEN the test suite runs THEN there SHALL be at least one test per counter that:
(a) sets the counter to its maximum value (e.g., `u32::MAX` or `u64::MAX`),
(b) invokes the creation function, and
(c) asserts that the call panics with the expected overflow error rather than succeeding.

---

### Unchanged Behavior (Regression Prevention)

**3.1 — Normal ID creation is unaffected**
WHEN a counter is below its maximum value THEN `create_escrow`, `issue_card`,
`process_payment`, `open_channel`, and `create_subscription` SHALL CONTINUE TO assign the
next sequential ID and succeed as before.

**3.2 — `submit_state` stale-sequence guard is preserved**
WHEN `submit_state` is called on a payment channel THEN the existing check
`sequence_number <= channel.sequence → Error::StaleState` SHALL CONTINUE TO function
independently of the new `ChannelCount` overflow guard.

**3.3 — Renewal cycle deduplication is preserved**
WHEN the `subscription_renewal` contract's `CycleKey` deduplication detects a duplicate
`cycle_id` THEN that `DuplicateRenewalRejected` path SHALL CONTINUE TO function independently
of the new `sub_id` uniqueness check.

**3.4 — RLS and address-based access control is preserved**
WHEN access-control checks (Soroban `require_auth()`, RLS policies) pass THEN they SHALL
CONTINUE TO be the primary runtime enforcement mechanism. The overflow guards and ID
uniqueness checks are defence-in-depth additions, not replacements.

**3.5 — `SubscriptionCounter` hybrid ID format is preserved**
WHEN `SubscriptionCounter` is below `u64::MAX` THEN the hybrid 8-byte-counter +
24-byte-user-hash ID format SHALL CONTINUE TO be generated identically.

---

## Bug Condition Pseudocode

```pascal
FUNCTION isOverflowCondition(counter, maxVal)
  INPUT: counter of numeric type, maxVal of same type
  OUTPUT: boolean
  RETURN counter >= maxVal
END FUNCTION
```

```pascal
// Property: Fix Checking — any counter at max must be rejected
FOR ALL C WHERE isOverflowCondition(C.value, C.typeMax) DO
  result ← contractCreateFn(C)
  ASSERT result IS Error WITH kind IN {
    CardLimitReached, TxLimitReached,
    EscrowLimitReached, ChannelLimitReached,
    SubscriptionLimitReached
  }
END FOR
```

```pascal
// Property: Preservation — counters below max continue to succeed
FOR ALL C WHERE NOT isOverflowCondition(C.value, C.typeMax) DO
  ASSERT contractCreateFn_before(C) = contractCreateFn_after(C)  // behavior unchanged
END FOR
```

```pascal
// Property: sub_id uniqueness
FOR ALL S WHERE persistentStorage.contains(sub_id S) DO
  result ← init_sub(S)
  ASSERT result IS Error WITH kind = DuplicateSubscriptionId
END FOR
```

---

## Acceptance Criteria Summary

| # | Criterion |
|---|---|
| AC-1 | `CardCounter` and `TxCounter` (u32) saturate — calling at `u32::MAX` panics with a named error |
| AC-2 | `EscrowCount` and `ChannelCount` (u64) saturate — calling at `u64::MAX` panics with a named error |
| AC-3 | `SubscriptionCounter` (u64) saturates — calling at `u64::MAX` panics with a named error |
| AC-4 | Off-chain `sequenceNumber` throws `SequenceOverflowError` when `>= Number.MAX_SAFE_INTEGER` |
| AC-5 | `card_id` u32 → u64 upgrade path is documented (decision record, not necessarily implemented) |
| AC-6 | `init_sub` rejects duplicate `sub_id` with `DuplicateSubscriptionId` |
| AC-7 | At least one overflow boundary test exists per counter, asserting the correct panic/error |
| AC-8 | All existing tests continue to pass (no regressions) |
