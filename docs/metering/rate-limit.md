# Per-Agent Rate Limiting at the Meter (#1447)

A spend cap answers *"how much may this agent cost?"* over a window. It does not
answer *"how fast may this agent ask?"* — an agent in a retry loop can blow
through its entire cap in seconds and hammer the upstream provider on the way,
and the meter only ever counts the damage afterwards. It never prevented it.

The rate limit is the missing orthogonal bound: a token bucket per agent and
route, charged **before** the meter reserves anything and **before** the
upstream is touched. A throttled call consumes neither tokens nor headroom and
never exhausts the cap. And the two failures stay distinguishable: "slow down"
is a 429, "out of money" is a 402.

Nothing here is implicit: the policy is per provider, per-route overrides are
supported, a sane default applies the moment a route is registered, and the
rejection advertises a `Retry-After` hint.

## 1. Policy shape

| Field | Values | Default | Meaning |
|---|---|---|---|
| `requestsPerInterval` | finite number ≥ 0 | `60` | Requests allowed per interval at steady state. |
| `intervalMs` | finite number > 0 | `60_000` | Length of the interval in milliseconds. |
| `burstAllowance` | finite number ≥ 0 | `30` | Burst headroom above the steady-state allowance, refilled at the same rate. |

The shipped default therefore admits 90 requests on the first burst, then a
sustained 1 request/second. The bucket has capacity
`requestsPerInterval + burstAllowance`; it refills at
`requestsPerInterval / intervalMs`. A policy of `0` / `0` denies everything
with `Retry-After: intervalMs`.

```bash
# at registration — applies to every route the provider later registers
POST /api/v3/providers
  { ..., "rateLimit": { "requestsPerInterval": 10, "intervalMs": 60_000, "burstAllowance": 0 } }

# as a per-route override — beats the provider default for this route only
POST /api/v3/providers/:providerId/routes
  { ..., "rateLimit": { "requestsPerInterval": 2, "intervalMs": 1_000, "burstAllowance": 0 } }

# or later — re-policy the provider default at runtime
PATCH /api/v3/providers/:providerId/rate-limit
  { "requestsPerInterval": 120 }
```

Validation rejects negative or non-finite values and patches that change
nothing (400 `no rate limit changes`); missing fields are filled from the
platform default.

## 2. The route as the unit of admission

The bucket is keyed by **agent id × route id**, so every agent of a provider
shares the route's budget and drains its *own* bucket. Two providers can serve
different paths at the same time without interfering, and agents cannot borrow
each other's allowance.

The **effective policy** for a route is `route.rateLimit ?? provider.rateLimit`.
It is installed into the limiter the moment the route is registered, re-installed
on revision, and refreshed for every route *without its own override* when the
provider default changes. A per-route override endures a provider re-policy —
an operator who throttled a route explicitly is not silently un-throttled by a
provider-wide retune. The single case with no policy is a route the wiring
never touched, which the gateway does not allow to happen: registration always
installs one.

## 3. Two distinguishable rejections

Ordering in `processPaidCall`: scope check → **rate limit** → degraded admission
→ meter reserve. Each failure is a distinct HTTP contract from the documented
gateway error taxonomy:

| Condition | HTTP | Code | Retry-After | What it says |
|---|---|---|---|---|
| Agent outran its burst budget on this route | `429` | `GATEWAY_RATE_LIMITED` | seconds until the next request may pass | *Slow down.* The funds are fine. |
| Meter cap has no headroom left | `402` | `GATEWAY_METER_INSUFFICIENT` | — | *Re-fund.* The rate is fine, the money is gone. |
| Counter store down, provider refuses | `503` | `GATEWAY_METER_DEGRADED` | `10` | The meter cannot be read at all (#1444). |

`429` bodies carry `retryAfterMs` and `action: "wait"`; `402` bodies carry
`available` / `needed` / `limit` and `action: "fund"`. A client can decide to
back off instead of giving up, or to top up instead of retrying — the two are
never conflated.

## 4. Why the meter did not get this

The decision to reject is a *policy* concern; the token bucket lives in the
metering core so it can be tested and reused, but the `Meter` interface stays
about accounting. The `RateLimiter` is consulted by the gateway, like the
degraded-admission controller — injected, optional in unit tests, and always
wired in production, because "unlimited" is not a default we ship.

## 5. Surfaces

| Surface | What it tells you |
|---|---|
| `PATCH /api/v3/providers/:id/rate-limit` | Re-policy the provider default at runtime; returns the merged policy. |
| `429 GATEWAY_RATE_LIMITED` + `Retry-After` | Throttled call — with `route`, `retryAfterMs`, `action: "wait"`. |
| `402 GATEWAY_METER_INSUFFICIENT` | Out-of-funds call — with `route`, `available`, `needed`, `limit`, `action: "fund"`. |

## 6. Where this lives

| File | Role |
|---|---|
| `packages/metering/src/rate-limit.ts` | Token bucket, policy normalization, defaults. |
| `packages/metering/src/reservation.ts` | Throws `OverageError` on insufficient allowance so the gateway can map "no headroom" to 402. |
| `backend/src/v3/provider-store.ts` | `rateLimit` on providers and routes, `updateRateLimit`, normalization. |
| `backend/src/v3/gateway-service.ts` | Consume in `processPaidCall`, policy sync, error guards. |
| `backend/src/v3/types.ts` | `MeterRateLimitedError` (429) and `MeterInsufficientFundsError` (402). |
| `backend/src/routes/v3-gateway.ts` | Schemas, composition root, runtime re-policy endpoint. |

Tests: `packages/metering/src/rate-limit.test.ts` (burst, steady-state refill,
retry-after math, per-agent/route isolation, rewind safety, normalization) and
`backend/tests/v3-rate-limit.test.ts` (429 vs 402 distinction, Retry-After,
runtime re-policy, per-route override standing).