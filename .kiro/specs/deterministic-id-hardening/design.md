# Deterministic ID Hardening — Design

## Purpose

This spec hardens identity and idempotency across the v3 data layer so that retried
calls and retried settlements are safe by construction. The single most consequential
correctness property is: **a retried call must not be metered twice, and a retried
settlement must not debit a channel twice.** This is designed once, at the data layer,
rather than patched per route.

## Idempotency key for a call

### Derivation

The call idempotency key is derived deterministically from the request so that a
retried request produces the same key and a genuinely different request produces a
different key.

```
call_idempotency_key = H(
  domain_tag,        // fixed constant, e.g. "v3.call.idem.v1"
  channel_id,        // the paying channel
  request_nonce,     // client-supplied nonce, unique per logical call
  canonical_body_hash // H(canonical_json(request_body))
)
```

- `canonical_body_hash` is computed over a canonical serialization of the request
  body (sorted keys, no insignificant whitespace) so that semantically identical
  bodies hash identically.
- The key is a pure function of the request; no server-side randomness or clock is
  mixed in. This makes it reproducible across retries and across processes.

### Retention window

- Keys are retained for `IDEMPOTENCY_RETENTION` (default: 24h, configurable).
- Retention must exceed the maximum client retry horizon plus the maximum
  settlement latency, so a late retry still hits the retained record.
- After the window elapses, the key may be evicted; a call arriving after eviction
  is treated as a fresh call. Eviction is time-based and monotonic.

## Meter increment idempotency

The meter increment is keyed by `call_idempotency_key`:

- On admission, the meter records `(call_idempotency_key -> metered_amount)`.
- A retried call with the same key finds the existing record and **does not**
  increment again; it returns the previously recorded result.
- The meter write and the key record are committed atomically (single transaction /
  single conditional write), so a crash cannot leave a metered amount without its
  key or a key without its metered amount.

## Channel-state submission idempotency

Channel-state submission is keyed by the **state nonce**:

- Each submitted channel state carries a monotonically increasing `state_nonce`.
- The settlement layer records the highest applied `state_nonce` per channel.
- A submission whose `state_nonce` is `<=` the last applied nonce is a **no-op**: it
  does not debit the channel again and returns the current channel state.
- A submission with a strictly greater nonce is applied exactly once and advances
  the recorded nonce atomically with the debit.

This makes a duplicate submission a no-op rather than a double debit.

## Same key, different body

When a request arrives with an idempotency key that already exists but whose
`canonical_body_hash` differs from the stored one:

- The request is **rejected as a conflict** (e.g. `409 Conflict` / `IDEMPOTENCY_KEY_REUSED`).
- The stored metered amount and channel state are left untouched.
- The conflict is surfaced to the caller rather than silently applying the new body.

A request with the same key and the same body hash is treated as a retry and returns
the original result.

## Crash between meter and settle

The meter increment and the settlement debit are two distinct effects. To cover the
crash-between-meter-and-settle case explicitly:

- Metering commits the `call_idempotency_key` record together with the metered amount.
- Settlement commits the `state_nonce` advance together with the channel debit.
- If the process crashes after metering but before settlement, the retained meter
  record means a retry will **not** re-meter; the retry proceeds to settlement, which
  is itself idempotent under the state nonce.
- If the process crashes after settlement but before acknowledging, the retry finds
  the advanced `state_nonce` and is a no-op for the debit, while the meter record
  prevents a second meter increment.

Because each effect is guarded by its own idempotency key and committed atomically
with that key, replaying any prefix of the sequence converges to the same state.

## Property test (done criterion)

The design is validated by a property test that:

1. Generates arbitrary call sequences.
2. Injects duplicate calls (same key, same body) and duplicate settlements
   (same state nonce).
3. Injects crashes at arbitrary points between meter and settle.
4. Asserts that the resulting balance always equals the balance of the
   deduplicated sequence.

This property is the acceptance gate for the data-layer idempotency design.
