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

## Idempotency Requirements (Issue #1419)

This section defines the idempotency contract that spans admission, metering, and
settlement. It is designed once, at the data layer, so that retries and crash recovery
never double-meter a call or double-debit a channel.

### 4.1 — Call idempotency key derivation

WHEN a paid call is admitted THEN the data layer SHALL derive a deterministic
`call_idempotency_key` from the request, defined as:

```
call_idempotency_key = sha256(
  tenant_id || 0x00 ||
  caller_address || 0x00 ||
  route_id || 0x00 ||
  canonical_json(request_body)
)
```

where `canonical_json` sorts object keys lexicographically, preserves array order, and
encodes numbers in their shortest round-trippable form. The key is a 32-byte value and is
the sole identity used by metering and settlement for that call.

### 4.2 — Retention window

WHEN a `call_idempotency_key` is recorded THEN it SHALL be retained for a window of
`IDEMPOTENCY_RETENTION = 24 hours` (configurable, minimum 1 hour) measured from first
admission. After the window elapses the key MAY be evicted; a call arriving after eviction
is treated as a new call. The retention window SHALL be at least as long as the maximum
settlement retry horizon so that a retried settlement always finds its key.

### 4.3 — Idempotent meter increment

WHEN the meter is incremented for a `call_idempotency_key` THEN the increment SHALL be
performed as an insert-if-absent on the key:

- If the key is absent, the meter is incremented by one and the key is recorded with the
  resulting meter value.
- If the key is present, the meter is NOT incremented and the previously recorded meter
  value is returned.

A retried call therefore never meters twice, regardless of how many times it is replayed
within the retention window.

### 4.4 — Idempotent channel-state submission

WHEN a channel state is submitted THEN the submission SHALL be keyed by the state nonce
(`sequence_number`). A submission whose nonce is less than or equal to the channel's
current nonce SHALL be a no-op that returns the current channel state, rather than a
double debit. This extends the existing `StaleState` guard (3.2) so that a duplicate
submission is explicitly idempotent rather than merely rejected.

### 4.5 — Same key, different body

WHEN a `call_idempotency_key` is presented with a request body that differs from the body
recorded for that key THEN the data layer SHALL reject the request with a
`IdempotencyConflict` error and SHALL NOT meter, settle, or mutate any state. The recorded
body hash is compared against the hash of the incoming body; a mismatch is a conflict, not
a silent overwrite.

### 4.6 — Crash between meter and settle

WHEN the process crashes after the meter increment (4.3) but before settlement completes
THEN on recovery the settlement SHALL be re-driven from the recorded `call_idempotency_key`:

- The meter increment is already durable and is not repeated.
- Settlement is retried under the same key; because channel-state submission is idempotent
  under the nonce (4.4), a partially applied settlement is completed exactly once.

A settlement record SHALL carry the `call_idempotency_key` so that recovery can locate and
resume it without re-metering.

### 4.7 — Property test (Done criterion)

WHEN the property test replays an arbitrary call sequence with duplicates and injected
crashes THEN the resulting balance SHALL equal the balance of the deduplicated sequence.

```pascal
// Property: Idempotency — duplicates and crashes do not change the balance
FOR ALL sequence S OF calls DO
  deduped ← dedupeByCallIdempotencyKey(S)
  expected ← balanceOf(deduped)
  actual ← balanceOf(replayWithDuplicatesAndCrashes(S))
  ASSERT actual = expected
END FOR
```

### 4.8 — Unchanged behavior under idempotency

**4.8.1** WHEN a call is admitted for the first time THEN it SHALL be metered exactly once
and settled exactly once, as before.

**4.8.2** WHEN distinct calls (distinct keys) are admitted THEN each SHALL be metered and
settled independently; idempotency SHALL NOT coalesce distinct calls.

**4.8.3** WHEN the retention window has elapsed and a key is evicted THEN a subsequent call
with the same request SHALL be treated as a new call, consistent with 4.2.

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
  result ← contractCreateFn(C)
  ASSERT result IS Success
END FOR
```
