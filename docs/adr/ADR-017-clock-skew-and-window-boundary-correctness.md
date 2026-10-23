# ADR-017: Authoritative Clock per Decision, Skew Bound, and Ledger-Time Policy

**Status:** Accepted  
**Date:** 2026-09-29  
**Deciders:** Backend Engineering, Platform  
**Issue:** #448  
**Related ADRs:** [ADR-016](./ADR-016-metering-core-typescript-promotion.md), [ADR-005](./ADR-005-payment-channels-for-renewals.md)

---

## Context

Windows, reservation timeouts, cap periods, and channel challenge periods are all
time-dependent. The meter, the gateway, the settlement engine, and the chain do
**not** share a clock:

- The meter runs in the TypeScript gateway process.
- The settlement engine may run in a separate process or worker.
- The Soroban chain has its own ledger time (`env.ledger().timestamp()`).
- Clients supply timestamps in request headers that could be arbitrarily wrong.

Without a clear policy for which clock is authoritative for each decision, three
failure modes are live in the codebase:

1. **Window mis-filing** — a commit uses a client-supplied timestamp to derive its
   window boundary, placing usage in the wrong window. Settlement reads the wrong
   total.

2. **Silent skew** — the meter clock drifts from the settlement clock. A call that
   the meter places in window N is settled by the engine in window N-1 because the
   engine's clock is behind. The mismatch is never detected.

3. **Boundary races** — a call that arrives 1 ms before a window boundary is placed
   in window N. If processing takes 2 ms the commit happens 1 ms after the boundary
   and may be mis-filed in window N+1. The test suite does not exercise this case
   deterministically.

---

## Decision

### Rule 1 — Each time-dependent decision names its authoritative clock

| Decision | Authoritative clock | Rationale |
|---|---|---|
| **Window boundary** (which window a usage unit belongs to) | **Meter process clock** (`MeterClock`) — the clock injected into `WindowStore` | Only the meter sees the full usage stream; no other party can re-derive the boundary |
| **Reservation expiry** | **Meter process clock** | Expiry is local to the reservation ledger; no cross-service agreement needed |
| **Cap period boundary** | **Meter process clock** | Cap periods are metering-internal; align with window boundaries |
| **Channel challenge timeout** | **Ledger time** (`env.ledger().timestamp()` in Soroban) | Challenges are enforced on-chain; the chain's clock is the only one that matters |
| **Receipt timestamp** (`meteredAt`) | **Meter process clock** | The receipt is produced by the meter; it records when the meter saw the call |
| **Settlement timestamp** | **Settlement engine clock** | Settlement is a separate step; it records when settlement happened |
| **Audit log timestamps** | **Server wall clock** at the point of log entry | Audit logs are local; no cross-service agreement required |

### Rule 2 — Window boundaries are never derived from client-supplied timestamps

A client-supplied timestamp (e.g. from a request header, a signed payload timestamp,
or a channel state `created_at`) is **never** used to compute the window boundary
that determines which billing window a usage unit lands in.

Client timestamps are:
- Stored as `clientTimestampMs` on usage records for audit purposes.
- Validated against the meter clock for skew detection (Rule 3).
- **Never** passed to `windowBoundary()` or `WindowStore.recordUsage()` as the
  placement timestamp.

The placement timestamp is always `meterClock.now()` — the meter's own clock read
at the moment the commit is processed.

### Rule 3 — Acceptable skew is bounded, detected, and alerted

Maximum acceptable clock skew between any two services that share a time-dependent
decision: **5 seconds** (`MAX_SKEW_MS = 5_000`).

When a client-supplied timestamp differs from the meter clock by more than
`MAX_SKEW_MS`:

- The `ClockSkewGuard` logs a structured warning with the observed skew.
- The warning includes the principal, the client timestamp, the meter timestamp,
  and the drift in milliseconds.
- The usage is still recorded (using the meter clock for placement) — skew is not a
  reason to lose usage, but it is a reason to alert.
- If skew exceeds `HARD_SKEW_MS = 60_000` (60 s), the guard throws
  `ClockSkewError`, rejecting the usage as the timestamp cannot be reconciled.

### Rule 4 — Ledger time is authoritative for on-chain decisions

For decisions enforced by a Soroban contract (channel challenge period, dispute
window, TTL expiry), the chain's ledger time is always authoritative. The gateway
must not make admission decisions based on its own clock for these periods: it should
read the on-chain state rather than computing expiry locally.

---

## Implementation

The policy is enforced in code, not only in documentation:

### `clock.ts` (new)

```typescript
interface MeterClock {
  now(): number;         // epoch ms
  source: ClockSource;   // 'system' | 'ledger' | 'test'
}

class ClockSkewGuard {
  check(clientTimestampMs: number, context: string): void;
  // Logs a warning if |clientTimestampMs - this.clock.now()| > MAX_SKEW_MS.
  // Throws ClockSkewError if drift > HARD_SKEW_MS.
}
```

### `window.ts` (updated)

- `ClosedWindowRecord` gains a `clockSource: ClockSource` field.
- `LateRecord` gains a `clockSource: ClockSource` field.
- `WindowStore.recordUsage()` signature change: the `timestampMs` parameter is
  renamed to `meterTimestampMs` and a JSDoc comment states it **must be the meter
  clock's value**, never a client-supplied value. The method no longer accepts an
  optional `clientTimestampMs` for placement — placement is always by meter time.

### `meter.ts` (updated)

- `InMemoryMeter.commit()` passes `this.clock()` to `windowStore.recordUsage()`,
  never any value from the caller.
- `InMemoryMeter.reserve()` stamps `expiresAt` using `this.clock()`.

---

## Boundary test requirement

The boundary test must be **deterministic**: the clock is injected, not read from
`Date.now()`. Three cases are required:

1. Call arrives 1 ms **before** boundary → lands in window N.
2. Call arrives 1 ms **after** boundary → lands in window N+1.
3. Call arrives **exactly** on boundary → lands in window N+1 (boundary is the start
   of the new window, `floor(t/d)*d`).

---

## Consequences

### Positive

- Every usage record in the system carries a `clockSource` so post-hoc audits can
  identify records made under unusual conditions.
- Skew between the meter and client is detected and alerted rather than silently
  mis-filing usage.
- Boundary races are eliminated: the meter clock is read once, at commit time, and
  that single value determines both the window and the receipt timestamp.
- Tests are deterministic: the clock is injected everywhere.

### Negative / Trade-offs

- Callers that previously passed a client timestamp as `timestampMs` to
  `recordUsage` must update to pass the meter clock value. This is a breaking
  change to `WindowStore.recordUsage()`'s semantics (the signature is unchanged, but
  the contract is stricter).
- The `clockSource` field adds ~8 bytes per record. Negligible.

---

## Compliance Checklist

- [x] `clock.ts` defines `MeterClock`, `SystemClock`, `ClockSkewGuard`, `ClockSkewError`
- [x] `window.ts` updated: `clockSource` on records; JSDoc contract on `recordUsage`
- [x] `meter.ts` updated: `this.clock()` used exclusively for window placement
- [x] `clock-skew.test.ts` deterministic boundary tests pass
- [x] `index.ts` exports new clock types
- [x] ADR index updated
