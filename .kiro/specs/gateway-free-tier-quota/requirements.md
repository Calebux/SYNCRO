# Requirements Document

## Introduction

The v3 gateway currently requires every agent to hold a funded channel balance before making any paid call. This creates friction for providers who want to let agents evaluate an API before committing to payment — a common onboarding pattern. The free-tier quota feature lets a provider attach a quota rule to a rate card: N free calls (or units) per window per agent or per principal. Free calls are served, metered, and receipted at a price of zero — no channel and no pre-funded balance required. Once the quota is exhausted the caller receives a 402 (`GATEWAY_FREE_QUOTA_EXHAUSTED`) and must fund normally. Free usage appears in analytics alongside paid usage so operators can track cost and detect abuse.

## Glossary

- **Gateway**: The v3 gateway service (`V3GatewayService`) that meters, routes, and receipts paid calls.
- **Agent**: An entity registered via `AgentConsoleService` that calls the Gateway on behalf of a principal.
- **Principal**: The human or organisation that owns one or more Agents and signs spending authority grants.
- **Provider**: A registered API provider who owns routes and rate cards on the Gateway.
- **Rate_Card**: The active price schedule for a route, identified by `versionId` (`RateCardVersion` in `types.ts`).
- **Free_Quota_Rule**: An optional sub-object added to a `RateCardVersion` that specifies `freeUnits`, `window`, and `scope`.
- **Free_Call**: A call that is covered by an active Free_Quota_Rule and therefore settles at a price of zero.
- **Paid_Call**: A call that falls outside or after the Free_Quota_Rule and settles at the rate-card price.
- **Quota_Window**: The rolling time interval over which free usage is counted. Supported values: `day`, `week`, `month`.
- **Quota_Scope**: The identity dimension against which the Free_Quota_Rule is enforced: `agent` (per agent key) or `principal` (per principal across all their agents).
- **Quota_Counter**: The durable counter that tracks free units consumed within the current Quota_Window for a given (route, scope-identity) pair.
- **Quota_Enforcer**: The component within the Gateway that checks, decrements, and resets Quota_Counters.
- **Free_Receipt**: A `PaidReceipt` issued for a Free_Call where `amount` is `0` and `isFree` is `true`.
- **Meter**: The `Meter` interface (`reserve` / `commit` / `release` / `read`) used for Paid_Calls.
- **Channel**: The on-chain payment channel required for Paid_Calls; not required for Free_Calls.
- **Stroops**: The smallest on-chain unit of value (1 XLM = 10 000 000 stroops). Used internally for all prices.
- **Analytics_Service**: The service backing `GET /api/analytics/v3/usage` (principal) and `GET /api/analytics/v3/operator/usage` (operator).

---

## Requirements

### Requirement 1: Define the Free_Quota_Rule on a rate card

**User Story:** As a Provider, I want to attach a free-tier quota rule to a rate-card version, so that agents can try my API without pre-funding before they become paying customers.

#### Acceptance Criteria

1. THE Rate_Card SHALL accept an optional `freeQuota` field of type `Free_Quota_Rule` containing: `freeUnits` (a positive integer), `window` (one of `day`, `week`, `month`), and `scope` (one of `agent`, `principal`).
2. WHEN a Provider registers or revises a route and includes `freeQuota.freeUnits` that is not a positive safe integer, THE Gateway SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_FREE_QUOTA`.
3. WHEN a Provider registers or revises a route and includes `freeQuota.window` with a value other than `day`, `week`, or `month`, THE Gateway SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_FREE_QUOTA`.
4. WHEN a Provider registers or revises a route and includes `freeQuota.scope` with a value other than `agent` or `principal`, THE Gateway SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_FREE_QUOTA`.
5. WHEN a Provider omits the `freeQuota` field from a rate card, THE Gateway SHALL treat the route as having no free tier and require a funded channel for every call.
6. FOR ALL valid `Free_Quota_Rule` objects, serialising the rule to JSON and deserialising it SHALL produce an equivalent `Free_Quota_Rule` with identical `freeUnits`, `window`, and `scope` values (round-trip property).

---

### Requirement 2: Track quota consumption per window

**User Story:** As a Provider, I want the Gateway to maintain an accurate per-window count of free calls per agent (or per principal), so that the free tier cannot be exploited by rapid repeated calls.

#### Acceptance Criteria

1. THE Quota_Enforcer SHALL maintain a Quota_Counter keyed by `(routeId, scope-identity, window-start-timestamp)` where `scope-identity` is the agentId when `scope` is `agent`, or the principalId when `scope` is `principal`.
2. WHEN a Free_Call is committed, THE Quota_Enforcer SHALL increment the Quota_Counter for that call by the number of billable units consumed.
3. WHEN the current wall-clock time moves past the end of the Quota_Window, THE Quota_Enforcer SHALL treat the counter as zero for the new window, leaving the previous window's counter intact for audit purposes.
4. WHILE a Quota_Counter for the current window is less than `freeUnits`, THE Quota_Enforcer SHALL classify incoming calls as Free_Calls.
5. WHEN a Quota_Counter for the current window equals or exceeds `freeUnits`, THE Quota_Enforcer SHALL classify incoming calls as Paid_Calls.
6. FOR ALL quota sizes N ≥ 1 and any sequence of calls, the total free units committed in a window SHALL never exceed `freeUnits` (over-commit invariant).

---

### Requirement 3: Serve Free_Calls without a channel or balance

**User Story:** As an Agent, I want to make up to N calls on a free-tier route without providing a channel or any pre-funded balance, so that I can evaluate the API without an on-chain setup.

#### Acceptance Criteria

1. WHEN an incoming call is classified as a Free_Call by the Quota_Enforcer, THE Gateway SHALL NOT invoke `Meter.reserve` and SHALL NOT require a `channelId` in the request.
2. WHEN an incoming call is classified as a Free_Call, THE Gateway SHALL call the upstream and issue a Free_Receipt without consulting the Meter for reservation or commitment.
3. WHEN an incoming call is classified as a Free_Call and the upstream returns an error or is unreachable, THE Gateway SHALL NOT decrement the Quota_Counter and SHALL NOT issue a receipt.
4. WHEN an incoming call is classified as a Free_Call and the scope-enforcer rejects the agent (revoked, expired, missing scope), THE Gateway SHALL reject the call with the same scope-rejection error it would issue for a Paid_Call, and SHALL NOT decrement the Quota_Counter.
5. FOR ALL quota sizes N ≥ 1, calls 1 through N on a freshly created agent with an applicable Free_Quota_Rule SHALL succeed without a channel, and call N+1 SHALL fail with HTTP 402 and error code `GATEWAY_FREE_QUOTA_EXHAUSTED`.

---

### Requirement 4: Issue zero-price receipts for Free_Calls

**User Story:** As an Agent, I want a receipt for every free call I make, so that I have a verifiable record of the transaction even when I paid nothing.

#### Acceptance Criteria

1. WHEN the Gateway issues a receipt for a Free_Call, THE Free_Receipt SHALL include `amount: 0`, `isFree: true`, `unit`, `quantity`, `rateCardVersion`, `route`, `receiptId`, `timestamp`, and `signerPublicKey`.
2. WHEN the Gateway issues a receipt for a Free_Call, THE Free_Receipt SHALL omit `channelId` and `stateNonce` (or set them to null) because no channel is involved.
3. WHEN the Gateway issues a receipt for a Free_Call, THE Receipt_Service SHALL sign the Free_Receipt with the same Ed25519 key used for Paid_Calls so that callers can verify authenticity uniformly.
4. WHEN the Gateway issues a receipt for a Paid_Call on a route that also has a Free_Quota_Rule, THE receipt SHALL contain `isFree: false` and `amount` SHALL equal the actual charge in stroops.
5. FOR ALL Free_Calls on any route, the `amount` field on the resulting Free_Receipt SHALL equal zero regardless of the measured quantity or the route's `priceStroops`.

---

### Requirement 5: Return 402 with a machine-readable code when the quota is exhausted

**User Story:** As an Agent, I want a distinct, machine-readable error code when my free quota runs out, so that my runtime can automatically switch to funded mode instead of treating the rejection as a permanent error.

#### Acceptance Criteria

1. WHEN the Quota_Enforcer determines that the current window's counter equals or exceeds `freeUnits` and the caller presents no funded channel, THE Gateway SHALL return HTTP 402 with error code `GATEWAY_FREE_QUOTA_EXHAUSTED`.
2. WHEN returning `GATEWAY_FREE_QUOTA_EXHAUSTED`, THE Gateway SHALL include in the response body: `error` (the code), `message` (a human-readable explanation), and a `details` object containing `freeUnits`, `windowResetsAt` (ISO-8601 timestamp of the next window boundary), and `scope`.
3. THE Gateway SHALL NOT use `GATEWAY_FREE_QUOTA_EXHAUSTED` for any situation other than a free-tier quota being fully consumed.
4. THE Gateway SHALL NOT use `GATEWAY_METER_INSUFFICIENT` for free-tier quota exhaustion; the two codes are distinct so agents can distinguish "refill your balance" from "wait for the quota window to reset".
5. WHEN the quota is exhausted and the caller provides a valid, funded channel, THE Gateway SHALL treat the call as a Paid_Call and SHALL NOT return `GATEWAY_FREE_QUOTA_EXHAUSTED`.

---

### Requirement 6: Prevent quota farming via rapid agent creation

**User Story:** As an Operator, I want free quotas scoped to the principal when the Provider chooses `scope: principal`, so that a user cannot farm unlimited free calls by rapidly registering new agents.

#### Acceptance Criteria

1. WHEN `Free_Quota_Rule.scope` is `principal`, THE Quota_Enforcer SHALL key the Quota_Counter by the principalId rather than the agentId, so that all agents belonging to the same principal share one counter per route per window.
2. WHEN a principal registers a new agent after their principal-scoped free quota is exhausted, THE Quota_Enforcer SHALL continue to deny free calls for the new agent on that route within the same window.
3. WHEN `Free_Quota_Rule.scope` is `agent`, THE Quota_Enforcer SHALL key the Quota_Counter by agentId, giving each agent its own independent quota.
4. THE Agent_Console_Service SHALL continue to enforce the existing session-challenge rate limit (maximum 5 outstanding challenges per address) independent of any free-quota policy.
5. WHEN a principal's principal-scoped quota is exhausted and a new agent is registered by the same principal, calls from the new agent on the quota-exhausted route SHALL return `GATEWAY_FREE_QUOTA_EXHAUSTED` for the remainder of the current window.

---

### Requirement 7: Show free vs paid usage in principal analytics

**User Story:** As a Principal, I want to see how many of my calls were free and how many were paid in my usage dashboard, so that I can track my onboarding trial consumption and understand my billing.

#### Acceptance Criteria

1. WHEN the Analytics_Service returns principal usage data, THE response SHALL include per-route breakdown fields `freeCallCount`, `paidCallCount`, `freeUnitsConsumed`, and `paidUnitsConsumed` for each time-granularity bucket.
2. WHEN the Analytics_Service computes principal usage, THE `freeCallCount` field SHALL count only calls whose settlement record has `isFree: true` and `amount: 0`.
3. WHEN the Analytics_Service computes principal usage, THE `paidCallCount` field SHALL count only calls whose settlement record has `isFree: false`.
4. FOR ALL principal usage response payloads, `freeCallCount + paidCallCount` SHALL equal the total call count for every route-and-bucket combination (completeness invariant).
5. WHEN a principal has made no calls in the requested period, THE Analytics_Service SHALL return zero values for all free and paid counters rather than omitting those fields.

---

### Requirement 8: Show free vs paid usage in operator analytics

**User Story:** As an Operator, I want an aggregate view of free vs paid usage across all principals, so that I can monitor the cost of free tiers and detect unusual consumption patterns.

#### Acceptance Criteria

1. WHEN the Analytics_Service returns operator usage data, THE response SHALL include aggregate fields `totalFreeCallCount`, `totalPaidCallCount`, `totalFreeUnitsConsumed`, `totalPaidUnitsConsumed`, and `totalFreeValueStroops` (the total revenue foregone due to free calls) across all principals.
2. WHEN computing `totalFreeValueStroops`, THE Analytics_Service SHALL multiply each free call's `quantity` by the route's `priceStroops` at the time of the call, summing across all free settlements in the period.
3. WHEN the Analytics_Service returns operator usage data, THE response SHALL break down free and paid usage by route so the operator can identify which routes carry the highest free-tier load.
4. FOR ALL operator usage response payloads, `totalFreeCallCount + totalPaidCallCount` SHALL equal the total call count across all routes and principals for the requested period (completeness invariant).
5. WHEN no calls have occurred in the requested period, THE Analytics_Service SHALL return zero values for all operator-level free and paid counters rather than omitting those fields.

---

### Requirement 9: Record free calls in the settlement store

**User Story:** As a Provider, I want free calls to appear in the settlement store with a zero amount and an `isFree` flag, so that my revenue reporting is accurate and audits can distinguish free from paid traffic.

#### Acceptance Criteria

1. WHEN the Gateway commits a Free_Call, THE Gateway SHALL write a settlement record to the settlement store with `amount: 0`, `isFree: true`, `quantity` equal to the measured billable units, `priceStroops` equal to the route's configured price (for foregone-revenue calculations), and `status: 'unsettled'`.
2. WHEN the Gateway commits a Paid_Call on a route that also has a Free_Quota_Rule, THE Gateway SHALL write a settlement record with `isFree: false` and the actual `amount` in stroops.
3. THE settlement store SHALL accept and persist the `isFree` boolean field on all settlement records without breaking existing settlement queries that do not filter by `isFree`.
4. WHEN the Gateway writes a settlement record for a Free_Call, THE record SHALL include `receiptId`, `agentId`, `principalId`, `routeId`, `rateCardVersion`, `unit`, `quantity`, and `meteredAt` for full auditability.
5. FOR ALL settlement records where `isFree` is `true`, the `amount` field SHALL equal zero (zero-amount invariant for free settlements).

---

### Requirement 10: Degraded-mode and rate-limit interaction with free calls

**User Story:** As an Operator, I want free-tier calls to be subject to the same rate-limiting and degraded-mode policies as paid calls, so that a quota cannot be weaponised to flood an upstream during an outage.

#### Acceptance Criteria

1. WHEN a Free_Call arrives and the per-agent rate limiter determines the agent has exceeded its burst budget, THE Gateway SHALL return HTTP 429 with `GATEWAY_RATE_LIMITED` before checking the Quota_Counter, identical to the behaviour for Paid_Calls.
2. WHEN a Free_Call arrives and the degraded-admission controller determines the counter store is unavailable and the provider policy is `fail_closed`, THE Gateway SHALL return HTTP 503 with `GATEWAY_METER_DEGRADED`, identical to the behaviour for Paid_Calls.
3. WHEN a Free_Call arrives and the degraded-admission controller admits the call in fail-open mode, THE Quota_Enforcer SHALL attempt to increment the counter; if the counter store is unavailable, THE Gateway SHALL serve the call but flag the Free_Receipt with `meterDegraded: true`.
4. IF a Free_Call is served in degraded mode and the counter store later recovers, THEN THE Quota_Enforcer SHALL reconcile the missed increment against the current window's counter so that the total free units committed does not exceed `freeUnits` over the window.
5. THE rate-limit policy applied to Free_Calls SHALL be the same route-level `RateLimitPolicy` that applies to Paid_Calls on the same route, with no separate exemption for free-tier traffic.
