# ADR-016: Promote quota_guard to the TypeScript Metering Core

**Status:** Accepted  
**Date:** 2026-09-29  
**Deciders:** Backend Engineering, Platform  
**Issue:** #1440  
**Related ADRs:** [ADR-010](./ADR-010-quota-guard-rate-limiting.md), [ADR-005](./ADR-005-payment-channels-for-renewals.md)

---

## Context

`quota_guard/` is a small Python package (`tracker.py`, `degraded_mode.py`) that
implements the two hardest ideas in metering:

1. **Quota tracking** — counting usage against a limit within a sliding window,
   firing configurable alert thresholds, and recording upstream throttle responses.
2. **Degraded-mode evaluation** — deciding whether the system should enter a
   degraded posture based on the aggregate state of all trackers, and which
   individual services should be rate-limited, when the counter store is unavailable
   or when upstream quotas are nearly exhausted.

`quota_guard` was introduced as a Python sidecar that the TypeScript gateway calls
over HTTP (or a subprocess pipe) for each admission check. In v3, metering is the
component the whole product bills from. Every paid call flows through it.

### Problem: the cross-process hop is on the hot path

The v3 gateway processes paid calls in TypeScript. For each call it must:

1. Resolve the agent identity and scope.
2. **Reserve** an upper-bound quota.
3. Call the upstream API.
4. **Commit** (or **release**) the actual usage.
5. Produce a signed receipt.

Steps 2 and 4 are on the request path. A round-trip to a Python sidecar adds one
network hop (loopback or Unix domain socket) with a median of ~2–5 ms and a p99
spike of 20–50 ms under load. The gateway's total admission budget is 10 ms at p99
(see `admissionConfig.budget`). A cross-process hop blows that budget.

### Options considered

| Option | Description | Pros | Cons |
|---|---|---|---|
| A — Keep Python sidecar | Call `quota_guard` via HTTP/IPC from the gateway | No rewrite | Hot-path latency; separate deploy; Python runtime in a TS monorepo |
| B — Python → TypeScript port | Reimplement `quota_guard` logic in TypeScript inside `packages/metering` | Same process, zero IPC latency; single language; type-safe interface | Engineering cost of port |
| C — Hybrid | Keep Python for background analytics, TypeScript for admission | Best of both on paper | Two implementations to maintain; divergence risk |

### Why Option B

`quota_guard` contains ~180 lines of logic. The `packages/metering` package already
exists and holds the window (`window.ts`), reservation (`reservation.ts`), overage
policy (`overage.ts`), and WAL (`write-ahead-log.ts`) primitives. Porting the two
remaining Python concepts — a unified `Meter` interface and the `DegradedMode`
evaluator — to TypeScript costs ~3 hours and buys:

- **Zero hot-path latency** — `reserve` and `commit` are synchronous in-memory
  operations; no IPC, no serialisation.
- **Degraded mode as a first-class policy** — not a special case, but a property
  of the `Meter` instance itself: when the counter store is unavailable the meter
  activates its degraded policy and `reserve` still returns (with a degraded flag),
  keeping the gateway alive.
- **Single language** — TypeScript throughout the v3 stack; no Python runtime
  required at deploy time.
- **Type-safe interface** — `reserve`, `commit`, `release`, and `read` carry
  compile-time guarantees that the Python HTTP surface could not provide.

---

## Decision

**Reimplement `quota_guard` in TypeScript inside `packages/metering` and have the
gateway call the resulting `Meter` interface directly (same process, in-memory).**

The Python `quota_guard/` directory is retained as historical reference and as the
canonical source for the degraded-mode algorithm; it is not deleted. New production
metering work happens in TypeScript.

### Public interface

```typescript
// reserve — hold an upper-bound quota before the upstream call
reserve(principal: string, route: string, upperBound: number): MeterReservation;

// commit — settle against actual usage; releases unused headroom
commit(reservationId: string, actual: number): MeterCommitResult;

// release — return the full hold; used when the upstream call failed
release(reservationId: string): void;

// read — return current usage for a principal (fast path, no I/O)
read(principal: string): MeterReading;
```

### Degraded mode built in

When the counter store becomes unavailable (or a `DegradedModeEvaluator` signals
degraded posture), the `Meter` activates its degraded policy:

- `reserve` still returns a reservation tagged `degraded: true`.
- Usage is counted optimistically (allow-list semantics under degradation).
- Callers surface the `degraded` flag to the agent via a response header so the
  agent can decide whether to proceed.

This is a direct port of the Python `DegradedMode.evaluate()` semantics: the system
stays alive, individual over-quota services are flagged, and the caller is informed.

### Gateway wiring

`V3GatewayService.processPaidCall()` is updated to:

1. Call `meter.reserve(agentId, route, upperBound)` before the upstream call.
2. On upstream success: call `meter.commit(reservationId, actual)`.
3. On upstream failure: call `meter.release(reservationId)`.
4. Attach `MeterReading` to the receipt so settlement can read it.

Inline usage counting (`amount = route.price * quantity` stored directly without
a quota check) is replaced by the metered path.

---

## Domain Naming & Data Model Compliance

| Domain Term / Entity | Layer Affected | Proposed Representation | Alignment |
|---|---|---|---|
| **Meter** | Backend / packages/metering | `Meter` interface in `packages/metering/src/meter.ts` | New v3 concept; no v2 conflict |
| **Reservation** | Backend / packages/metering | `MeterReservation` (extends existing `Reservation`) | Extends `reservation.ts` |
| **Settlement** | Backend | `MeterCommitResult` feeds `RecordSettlementInput` | Consistent with channel settlement semantics |
| **Principal / Agent** | Backend / contracts | `principal: string` = agentId | Consistent with `policy.ts` Principal type |

---

## Consequences

### Positive

- Hot-path admission (`reserve`) is a synchronous `Map` lookup: < 1 ms at p99.
- Degraded mode is always active and tested; it is not a special case that can
  be forgotten.
- Single language reduces operational surface.
- The `Meter` interface is a stable boundary: future backends (Redis, Supabase)
  can be swapped in without touching the gateway.

### Negative / Trade-offs

- The Python `quota_guard` package is no longer the running implementation; any
  Python tooling that called it must be updated.
- Persistence is in-memory by default. A process restart loses the current
  window's counter (the WAL handles durability for committed usage, but not for
  held reservations). This is acceptable because reservations expire and are
  swept on the next `reserve` call.

---

## Compliance Checklist

- [x] Domain terminology adheres to `docs/DOMAIN_GLOSSARY_AND_DATA_MODEL.md`
- [x] Public interface defined in `packages/metering/src/meter.ts`
- [x] Degraded-mode evaluator ported in `packages/metering/src/degraded.ts`
- [x] Gateway wired in `backend/src/v3/gateway-service.ts`
- [x] Unit tests in `packages/metering/src/meter.test.ts`
- [x] ADR index updated in `docs/adr/README.md`
