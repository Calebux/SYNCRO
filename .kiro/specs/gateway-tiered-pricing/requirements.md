# Requirements Document

## Introduction

The v3 gateway rate card (`RateCardVersion` in `types.ts`) currently supports a single flat `priceStroops` per billable unit. Real API pricing is graduated: the first 10 000 calls fall into one price band, the next 90 000 into a cheaper band, and anything above that at the cheapest rate. Additionally, large customers negotiate individual prices that replace the standard tier schedule entirely.

This feature extends `RateCardVersion` with two optional additions:

1. **Graduated tiers** — an ordered list of `{ upToUnits, priceStroops }` entries where each entry covers a cumulative usage band within a billing window. The last tier has no `upToUnits` and covers all usage above the previous band. Volume is tracked per-principal per-route within a billing window (`day`, `month`, or `rolling-30-days`); the counter resets at every window boundary, resetting the tier position.
2. **Per-principal overrides** — a provider can pin a named principal to a fixed tier schedule (or flat price) that replaces the global tier list for that principal only.

Charges are computed with a **graduated** (not volume) model: usage in each tier is priced at that tier's rate; there is no retroactive repricing of earlier units when a threshold is crossed.

Every call's charge must be fully reproducible from the settlement record alone — the tier schedule and any override in effect at call time are stored on the settlement record so an auditor can recompute the charge without querying live configuration.

Receipts are extended to identify which tier (index and per-unit price) or override applied, so callers can verify their charge against the published schedule.

## Glossary

- **Gateway**: The v3 gateway service (`V3GatewayService`) that meters, routes, and receipts paid calls.
- **Provider**: A registered API provider who owns routes and rate cards on the Gateway.
- **Principal**: The human or organisation whose spending authority covers one or more Agents.
- **Agent**: An entity that calls the Gateway on behalf of a Principal.
- **Rate_Card**: The active price schedule for a route, identified by `versionId` (`RateCardVersion` in `types.ts`).
- **Tier**: One entry in a `PriceTier` list — a `priceStroops` and an optional `upToUnits` (cumulative unit threshold where this tier ends). The last tier omits `upToUnits` and is the overflow tier.
- **Tier_Schedule**: The ordered list of `Tier` entries attached to a `Rate_Card`. Tiers are applied in list order; the first tier whose `upToUnits` has not yet been reached by the window counter covers the current call.
- **Overflow_Tier**: The final entry in a `Tier_Schedule` — the entry with no `upToUnits` — which covers all units above the last threshold.
- **Graduated_Pricing**: The charge model where each unit is priced at the rate of the tier it falls within. Units in earlier tiers are never retroactively repriced when a threshold is crossed.
- **Flat_Price**: The original single-tier model: a single `priceStroops` on `RateCardVersion` with no `Tier_Schedule`. Remains valid; the new tier fields are optional.
- **Tier_Calculator**: The component that computes a charge using a `Tier_Schedule` and a window counter.
- **Billing_Window**: The time interval over which usage is accumulated before the counter resets. Supported values: `day`, `month`, `rolling-30-days`.
- **Window_Counter**: The durable per-`(routeId, principalId, window-start-timestamp)` counter that tracks cumulative billable units consumed in the current window. Determines tier position.
- **Window_Counter_Store**: The durable store that persists `Window_Counter` values across calls.
- **Principal_Override**: An optional record keyed by `principalId` on a `Rate_Card` that provides a replacement `Tier_Schedule` (or flat `priceStroops`) for that principal only. All other principals use the global `Tier_Schedule`.
- **Pricing_Snapshot**: The serialised pricing state captured on the settlement record at call time — the full `Tier_Schedule` (or override) and the window counter before and after the call — from which the charge can be independently recomputed.
- **Tier_Receipt_Fields**: The additional fields added to `PaidReceiptPayload` that identify which tier (or override) applied and the per-unit price used.
- **Stroops**: The smallest on-chain unit of value (1 XLM = 10 000 000 stroops). All prices are in stroops.
- **Settlement_Record**: The row written to the settlement store (`ProviderSettlement`) for every committed call.

---

## Requirements

### Requirement 1: Define the graduated tier schema on a rate card

**User Story:** As a Provider, I want to attach a graduated tier list to a rate-card version, so that high-volume callers automatically pay a lower per-unit rate once they cross usage thresholds within a billing window.

#### Acceptance Criteria

1. THE Rate_Card SHALL accept an optional `tiers` field containing a non-empty ordered list of `Tier` objects, where each `Tier` has a `priceStroops` (a positive safe integer) and an optional `upToUnits` (a positive safe integer representing the cumulative unit count at which this tier ends).
2. THE Rate_Card SHALL accept an optional `billingWindow` field with one of the values `day`, `month`, or `rolling-30-days` when a `tiers` list is present; `billingWindow` is required when and only when `tiers` is present.
3. WHEN a `tiers` list is present, THE Rate_Card SHALL require that exactly one `Tier` in the list omits `upToUnits` (the Overflow_Tier), and that `Tier` SHALL be the last entry in the list.
4. WHEN a `tiers` list is present and contains two or more entries, THE Rate_Card SHALL require that `upToUnits` values are strictly ascending from the first tier to the penultimate tier (e.g., the second tier's `upToUnits` must be strictly greater than the first tier's `upToUnits`).
5. WHEN a Rate_Card specifies both `priceStroops` (the flat-price field) and a `tiers` list simultaneously, THE Provider_Store SHALL reject the input with error code `GATEWAY_TIERED_PRICING_CONFLICT`.
6. WHEN a Rate_Card omits both `priceStroops` and `tiers`, THE Provider_Store SHALL reject the input with error code `GATEWAY_TIERED_PRICING_MISSING_PRICE`.
7. FOR ALL valid `Tier_Schedule` objects, serialising the schedule to JSON and deserialising it SHALL produce an equivalent `Tier_Schedule` with identical `priceStroops` and `upToUnits` values in the same order (round-trip property).

---

### Requirement 2: Validate tier schema on route registration and revision

**User Story:** As a Provider, I want the Gateway to reject malformed tier lists at publish time, so that invalid pricing never reaches callers.

#### Acceptance Criteria

1. WHEN a Provider registers or revises a route and supplies a `tiers` list where any `Tier.priceStroops` is not a positive safe integer, THE Provider_Store SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_TIER_PRICE`.
2. WHEN a Provider registers or revises a route and supplies a `tiers` list where any `Tier.upToUnits` is not a positive safe integer (excluding the Overflow_Tier which omits this field), THE Provider_Store SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_TIER_THRESHOLD`.
3. WHEN a Provider registers or revises a route and supplies a `tiers` list whose `upToUnits` values are not strictly ascending, THE Provider_Store SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_TIER_ORDER`.
4. WHEN a Provider registers or revises a route and supplies a `tiers` list with no Overflow_Tier (i.e., every entry has `upToUnits` defined), THE Provider_Store SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_TIER_NO_OVERFLOW`.
5. WHEN a Provider registers or revises a route and supplies a `tiers` list with more than one entry omitting `upToUnits`, THE Provider_Store SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_TIER_MULTIPLE_OVERFLOW`.
6. WHEN a Provider registers or revises a route and supplies a `billingWindow` with a value other than `day`, `month`, or `rolling-30-days`, THE Provider_Store SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_BILLING_WINDOW`.
7. WHEN a Provider registers or revises a route and supplies `tiers` without a `billingWindow`, THE Provider_Store SHALL reject the request with HTTP 400 and error code `GATEWAY_INVALID_BILLING_WINDOW`.
8. WHEN a Provider registers or revises a route with a `tiers` list containing exactly one entry (the Overflow_Tier alone), THE Provider_Store SHALL accept it as a valid single-tier graduated schedule.

---

### Requirement 3: Track per-principal usage within the billing window

**User Story:** As a Provider, I want the Gateway to maintain an accurate per-window billable-unit count per principal, so that tier positions advance correctly as principals consume more calls.

#### Acceptance Criteria

1. THE Window_Counter_Store SHALL maintain a Window_Counter keyed by `(routeId, principalId, window-start-timestamp)` that records cumulative billable units committed in that window.
2. WHEN a call is committed on a tiered route, THE Window_Counter_Store SHALL increment the Window_Counter for `(routeId, principalId, window-start-timestamp)` by the actual billable units settled for that call.
3. WHEN the current wall-clock time moves past the end of the Billing_Window, THE Gateway SHALL treat the counter as zero for the new window, leaving the previous window's counter intact for audit purposes.
4. WHEN `billingWindow` is `day`, THE Window_Counter_Store SHALL define the window boundary as midnight UTC of each calendar day.
5. WHEN `billingWindow` is `month`, THE Window_Counter_Store SHALL define the window boundary as midnight UTC on the first day of each calendar month.
6. WHEN `billingWindow` is `rolling-30-days`, THE Window_Counter_Store SHALL define the window boundary as exactly 30 × 24 × 60 × 60 seconds before the moment the current call is admitted.
7. FOR ALL billing windows, the Window_Counter at the end of a window SHALL equal the sum of the billable units of all committed calls within that window for the same `(routeId, principalId)` pair (accumulation invariant).

---

### Requirement 4: Compute graduated charges using the tier schedule

**User Story:** As a Provider, I want the Gateway to charge each unit at the rate of the tier it falls within, so that early units in a window stay at the higher rate and later units benefit from the lower rate without retroactive repricing.

#### Acceptance Criteria

1. WHEN a call arrives on a tiered route, THE Tier_Calculator SHALL determine the principal's current window counter value before the call and compute the charge by summing each tier's contribution: `max(0, min(actualUnits, tierEnd) - max(0, tierStart - counterBefore)) × tier.priceStroops`, where `tierStart` is the cumulative lower bound and `tierEnd` is `upToUnits` (or infinity for the Overflow_Tier).
2. WHEN a call's billable units span a tier boundary (some units fall in one tier and the remaining units fall in the next), THE Tier_Calculator SHALL split the charge at the boundary and sum the two parts rather than applying a single rate to all units.
3. WHEN the principal's window counter before the call already equals or exceeds the last `upToUnits` threshold, THE Tier_Calculator SHALL apply the Overflow_Tier rate to all units of this call.
4. WHEN a Rate_Card has only a flat `priceStroops` and no `tiers`, THE Gateway SHALL continue to call `calculateChargeStroops(priceStroops, units)` unchanged; the tiered path is not invoked.
5. FOR ALL sequences of calls on a tiered route within a single billing window, the total charge computed by accumulating per-call graduated charges SHALL equal the total charge that would result from computing the graduated schedule over the aggregate unit count for that window (additivity / no-retroactive-repricing invariant).
6. FOR ALL principal window counters ≥ 0 and all positive unit counts, `calculateTieredChargeStroops(tiers, counterBefore, units)` SHALL return a positive safe integer (never zero, never negative, never non-integer, never above `Number.MAX_SAFE_INTEGER`).

---

### Requirement 5: Attach per-principal price overrides to a rate card

**User Story:** As a Provider, I want to attach a named-principal price override to a rate-card version, so that large customers can negotiate a custom price that replaces the standard tier schedule only for them.

#### Acceptance Criteria

1. THE Rate_Card SHALL accept an optional `principalOverrides` field containing a map of `principalId → PrincipalOverride`, where each `PrincipalOverride` contains either a `priceStroops` (flat rate) or a `tiers` list (custom graduated schedule), but not both.
2. WHEN a Provider adds a `PrincipalOverride` with a `tiers` list, THE Provider_Store SHALL apply the same validation rules as Requirement 2 to the override's `tiers` list; invalid override tiers are rejected with the same error codes.
3. WHEN a Provider adds a `PrincipalOverride` with a `priceStroops`, THE Provider_Store SHALL validate that `priceStroops` is a positive safe integer; invalid values are rejected with `GATEWAY_INVALID_TIER_PRICE`.
4. WHEN the Gateway resolves pricing for a call and the principal has an entry in `principalOverrides` on the applicable `Rate_Card`, THE Gateway SHALL use the `PrincipalOverride`'s pricing exclusively and SHALL NOT apply the global `Tier_Schedule` to that principal.
5. WHEN the Gateway resolves pricing for a call and the principal has no entry in `principalOverrides`, THE Gateway SHALL use the global `Tier_Schedule` (or flat `priceStroops`) without modification.
6. WHEN a Provider sets a `PrincipalOverride` for a `principalId` that also has a Window_Counter from the global schedule, THE Gateway SHALL continue to use the same `(routeId, principalId, window-start-timestamp)` counter for the override — the override replaces the price schedule but does not reset the usage count.
7. FOR ALL calls on a route with a `principalOverrides` map, principals not listed in the map SHALL receive exactly the same charge as they would if the map were absent (non-interference property).

---

### Requirement 6: Store the pricing snapshot on the settlement record for deterministic reproducibility

**User Story:** As an Operator or Auditor, I want every settlement record to contain the full pricing state that was used to compute the charge, so that I can recompute the charge independently from the settlement row alone without querying live configuration.

#### Acceptance Criteria

1. WHEN the Gateway commits a call on a tiered route, THE Settlement_Record SHALL include a `pricingSnapshot` field containing: the `Tier_Schedule` (or the `PrincipalOverride` schedule that applied), the `billingWindow`, the `windowCounterBefore` (units accumulated before this call), and the `windowCounterAfter` (units accumulated including this call).
2. WHEN the Gateway commits a call on a flat-price route, THE Settlement_Record SHALL include a `pricingSnapshot` field containing: `priceStroops`, `windowCounterBefore: 0`, `windowCounterAfter: 0`, and `billingWindow: null`.
3. WHEN a `PrincipalOverride` was used, THE `pricingSnapshot` SHALL include a `principalOverrideId` field set to the `principalId` whose override applied, so the auditor knows which schedule was active.
4. FOR ALL settlement records, re-running `calculateTieredChargeStroops(snapshot.tiers, snapshot.windowCounterBefore, settlement.quantity)` (or `calculateChargeStroops(snapshot.priceStroops, settlement.quantity)` for flat) SHALL produce a value equal to `settlement.amount` (reproducibility invariant).
5. THE `pricingSnapshot` SHALL be stored as an immutable inline field on the settlement record and SHALL NOT reference the live `RateCardVersion` by pointer — the snapshot value must not change if the rate card is later revised.

---

### Requirement 7: Extend receipts with tier information

**User Story:** As a Principal, I want my receipt to show which tier (or override) covered my call and the per-unit price that was used, so that I can verify my charge against the published rate card.

#### Acceptance Criteria

1. WHEN the Gateway issues a receipt for a call priced by a `Tier_Schedule`, THE `PaidReceiptPayload` SHALL include a `appliedTier` field containing: `tierIndex` (zero-based position in the schedule), `priceStroops` (the per-unit rate of that tier), and `tierType` set to `"graduated"`.
2. WHEN the Gateway issues a receipt for a call that spans a tier boundary (units were split across two tiers), THE `PaidReceiptPayload` SHALL include an `appliedTier` field with `tierType` set to `"split"`, a `splitDetail` array listing each sub-tier's `tierIndex`, `units`, and `priceStroops`, and the total `priceStroops` SHALL be omitted in favour of `splitDetail`.
3. WHEN the Gateway issues a receipt for a call priced by a `PrincipalOverride`, THE `PaidReceiptPayload` SHALL include an `appliedTier` field with `tierType` set to `"override"` and `overridePrincipalId` equal to the `principalId` whose override applied.
4. WHEN the Gateway issues a receipt for a call priced by the original flat `priceStroops` (no tiers, no override), THE `PaidReceiptPayload` SHALL include an `appliedTier` field with `tierType` set to `"flat"` and `priceStroops` equal to the flat price used.
5. THE `appliedTier` field SHALL be included in the signed receipt payload so that the Ed25519 signature covers the tier information and callers can verify it has not been altered.
6. FOR ALL receipts, the `amount` field SHALL equal the charge that can be derived from `appliedTier` (using `splitDetail` when present) applied to `quantity` (self-consistency invariant).

---

### Requirement 8: Return distinct machine-readable error codes for tier validation failures

**User Story:** As a Provider, I want tier-related validation errors to be distinct and machine-readable, so that my tooling can surface the precise problem rather than a generic failure.

#### Acceptance Criteria

1. THE Gateway SHALL use error code `GATEWAY_INVALID_TIER_PRICE` exclusively for `priceStroops` values in a tier (or override) that are not positive safe integers.
2. THE Gateway SHALL use error code `GATEWAY_INVALID_TIER_THRESHOLD` exclusively for `upToUnits` values that are not positive safe integers.
3. THE Gateway SHALL use error code `GATEWAY_INVALID_TIER_ORDER` exclusively for `upToUnits` sequences that are not strictly ascending.
4. THE Gateway SHALL use error code `GATEWAY_INVALID_TIER_NO_OVERFLOW` exclusively for tier lists that contain no Overflow_Tier.
5. THE Gateway SHALL use error code `GATEWAY_INVALID_TIER_MULTIPLE_OVERFLOW` exclusively for tier lists that contain more than one entry without `upToUnits`.
6. THE Gateway SHALL use error code `GATEWAY_INVALID_BILLING_WINDOW` exclusively for missing or unrecognised `billingWindow` values.
7. THE Gateway SHALL use error code `GATEWAY_TIERED_PRICING_CONFLICT` exclusively for rate cards that supply both `priceStroops` and `tiers`.
8. THE Gateway SHALL use error code `GATEWAY_TIERED_PRICING_MISSING_PRICE` exclusively for rate cards that supply neither `priceStroops` nor `tiers`.
9. THE Gateway SHALL NOT reuse `GATEWAY_INVALID_FREE_QUOTA` or `GATEWAY_PRICE_CEILING_EXCEEDED` for any tiered-pricing validation failure.
10. WHEN returning any tier-related validation error, THE Gateway SHALL include in the response body: the error code, a human-readable `message`, and a `details` object identifying the offending field and its value.

---

### Requirement 9: Property-test invariant — tiered totals equal the sum of per-call charges

**User Story:** As an Engineer, I want a property test to verify that the sum of per-call graduated charges across all calls in a window equals the charge computed over the aggregate unit count for the same window, so that the tier calculation is free of boundary-rounding bugs.

#### Acceptance Criteria

1. FOR ALL valid `Tier_Schedule` objects, FOR ALL sequences of positive billable-unit counts whose sum does not exceed `Number.MAX_SAFE_INTEGER`, the sum of `calculateTieredChargeStroops(tiers, cumulativeBefore, units)` for each call (advancing `cumulativeBefore` after each) SHALL equal `calculateTieredChargeStroops(tiers, 0, totalUnits)` where `totalUnits` is the sum of all per-call unit counts (additivity property).
2. FOR ALL valid `Tier_Schedule` objects with a single entry (the Overflow_Tier alone), `calculateTieredChargeStroops(tiers, anyCounter, units)` SHALL equal `tiers[0].priceStroops * units`, matching the flat-price result for the same `priceStroops` (single-tier equivalence property).
3. FOR ALL valid `Tier_Schedule` objects, FOR ALL window counters ≥ 0, `calculateTieredChargeStroops(tiers, counter, 0)` SHALL return 0 (zero-units property).
4. FOR ALL valid `Tier_Schedule` objects, FOR ALL window counters ≥ 0 and unit counts > 0, `calculateTieredChargeStroops(tiers, counter, units)` SHALL be strictly greater than 0 (positive-charge property).

---

### Requirement 10: Property-test invariant — overrides apply only to the named principal

**User Story:** As an Engineer, I want a property test to verify that a per-principal override changes the charge for the target principal and leaves all other principals unaffected, so that override logic does not bleed across customer boundaries.

#### Acceptance Criteria

1. FOR ALL `Rate_Card` objects with a non-empty `principalOverrides` map, FOR ALL principals not listed in the map, the charge computed by the Gateway SHALL equal the charge that would be computed if the `principalOverrides` map were absent (non-interference property).
2. FOR ALL `Rate_Card` objects with a `PrincipalOverride` for principal P, FOR ALL calls made by principal P, the charge SHALL be computed using the override schedule rather than the global schedule, and the resulting `appliedTier.tierType` SHALL be `"override"` (override-application property).
3. FOR ALL `Rate_Card` objects with a `PrincipalOverride` for principal P and a global `Tier_Schedule`, the Window_Counter for principal P SHALL advance by the same call's `quantity` regardless of whether the global schedule or the override is used (counter-independence property).
4. FOR ALL `Rate_Card` objects, adding a `PrincipalOverride` for principal P and then removing it (by publishing a new `RateCardVersion` without that override) SHALL result in subsequent calls by P being priced at the global schedule rather than the removed override (override-removal property).
