# Degraded Mode: Behaviour When the Counter Store Is Unavailable (#1444)

The gateway meters every paid call against a counter store: reserve before the
upstream call, commit on the way out. That store can be unreachable — a Redis
failover, a network partition, a deployment. When it is, the gateway has exactly
two choices: **refuse paid traffic** or **serve it unbilled**. This document is
the decision, the bound on the second option, the record it leaves behind, and
the noise it makes so nobody discovers an outage from an invoice.

Nothing here is implicit: the policy is per provider, the unbilled exposure is
capped, the calls are written down before they are served, and every transition
alerts.

## 1. Per-provider policy

Each provider registers (and may re-policy at runtime) what it does during an
outage:

| Field | Values | Default | Meaning |
|---|---|---|---|
| `failMode` | `fail_open` \| `fail_closed` | `fail_open` | Serve unbilled, or refuse with 503. |
| `exposureCeiling` | finite number ≥ 0 | `100` | Value (in the route's pricing unit) the provider may serve unbilled during **one** outage. |

```bash
# at registration
POST /api/v3/providers
  { ..., "degradedMode": { "failMode": "fail_closed" } }

# or later
PATCH /api/v3/providers/:providerId/degraded-mode-policy
  { "exposureCeiling": 50 }
```

Cheap, high-volume routes are the fail-open case: refusing them is worse than
reconciling them. Expensive routes are the fail-closed case: a meter you cannot
see is not worth the write. The default is fail-open so that an *unconfigured*
provider degrades toward availability rather than toward an outage inside an
outage — but it degrades only as far as the ceiling allows.

Validation rejects unknown `failMode` values, negative or non-finite ceilings,
and patches that change nothing (400 `no degraded mode changes`).

## 2. Bounded fail-open

Before the upstream call the gateway computes the worst case of that call —
`route price × upper bound` — and asks the admission controller
(`DegradedAdmissionController`) whether it may proceed:

- **Counter store up** → admitted, nothing held, response is untouched.
- **Down, fail-open** → admitted *and that much headroom is held* against the
  provider's ceiling, so concurrent calls cannot jointly overshoot it.
- **Down, fail-closed** → refused.
- **Down, ceiling would be passed** → refused; this is the bound on fail-open.

The hold is released exactly once: on success `settle()` converts it into a
logged record for the actual amount; if the upstream call throws, `rollback()`
returns the headroom because nothing was served. Either way the hold is
consumed, so settling or rolling back the same hold again is a no-op.

Once a provider exhausts its ceiling it fails closed for the rest of that
outage and emits a `ceiling_exhausted` event (logged at `error`). The ceiling is
per outage, not per window: `enter()` resets every bucket, so a recovered store
gives each provider a fresh budget.

## 3. Durable log of degraded calls

Everything served unbilled is appended, as one JSON object per line, to a file
the gateway owns:

```
$METER_DEGRADED_LOG_PATH        # default: <cwd>/data/metering/degraded-usage.jsonl
```

The directory is created on demand and the path is git-ignored: the log is
operational state, reconciled, never committed. Each record carries the fields
reconciliation needs and nothing it does not:

| Field | Purpose |
|---|---|
| `id` | Idempotency key — the receipt id, so a replayed write cannot double-count. |
| `outageId` | Groups every record from one outage. |
| `providerId`, `principal`, `route` | Who was served. |
| `receiptId`, `reservationId` | Joins to the receipt and the meter reservation. |
| `units`, `amount`, `meteredAt` | What to bill for. |

Torn final lines (a crash mid-append) are skipped on read rather than failing
the whole file.

## 4. Alerting

Transitions are loud on three channels:

- **Logs** — `error` on entry (outage id, budget, counts), `warn` on exit, and
  `error` on ceiling exhaustion. This channel is always on.
- **Operator notifications** — `degraded_mode_entered` / `degraded_mode_exited`
  with a `DegradedModePayload` describing the `counter-store` dependency.
- **Audit + console** — a `system.degraded_mode` audit entry with before/after
  state, which the dashboard renders as a "Degraded metering" alert card.

The notification and audit legs are best-effort and skipped when
`NODE_ENV=test`; a failure there is logged, never allowed to fail the admission
path.

## 5. Surfaces

| Surface | What it tells you |
|---|---|
| `GET /api/v3/gateway/degraded` | Live posture: `degraded`, `outageId`, `enteredAt`, `counterStoreAvailable`, `logPath`, per-provider `exposureUsed` / `degradedCalls` / `rejectedCalls`, and totals. |
| `PATCH /api/v3/providers/:id/degraded-mode-policy` | Re-policy a provider while the outage is running. |
| `X-Meter-Degraded: 1` | Response header on a call served unbilled — the agent can see that the meter it is reading is not authoritative. |
| `503 GATEWAY_METER_DEGRADED` + `Retry-After: 10` | A refused call, with `reason: fail_closed \| exposure_ceiling`, matching the documented gateway error taxonomy so SDKs retry instead of surfacing a hard failure. |

## 6. Reconciliation playbook

1. On exit (or before settling an outage still in progress), read the log path
   from `GET /api/v3/gateway/degraded`.
2. Deduplicate by `id` (receipt id) — `dedupeDegradedUsage()` in
   `@handsoff/metering` does this for you.
3. Join each record to its receipt by `receiptId`; anything without a receipt is
   a record the gateway wrote but the receipt store did not keep — resolve
   before billing.
4. Settle the joined records as normal usage and archive the file for the
   outage's `outageId`.

## 7. Where this lives

| File | Role |
|---|---|
| `packages/metering/src/degraded-admission.ts` | Policy, admission, holds, snapshot. |
| `packages/metering/src/degraded-log.ts` | Durable JSONL log and dedupe. |
| `backend/src/v3/counter-store-health.ts` | The availability flag the decision hangs on. |
| `backend/src/v3/degraded-alerts.ts` | Entry/exit/ceiling alerting. |
| `backend/src/v3/gateway-service.ts` | Admission, rollback, settle on the paid-call path. |
| `backend/src/routes/v3-gateway.ts` | Composition root, policy and posture endpoints. |

Tests: `packages/metering/src/degraded-admission.test.ts` (policy, holds,
ceiling, log, snapshot) and `backend/tests/v3-degraded-mode.test.ts` (fail-open
serve, ceiling 503, fail-closed refusal, rollback, recovery, runtime
re-policy).
