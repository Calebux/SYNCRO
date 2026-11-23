# Requirements Document

## Introduction

The v3 gateway allows agents to make paid calls where the final charge is not known until the upstream responds (because pricing units such as tokens or bytes are measured from the response body). This creates a risk for agents: a call may cost more than the agent budgeted. The price-ceiling feature lets a caller declare, in a single request header, the maximum it is willing to pay for one call. The gateway enforces that ceiling at every stage — rejecting the call up front when the minimum price already exceeds the ceiling, capping the meter reservation at the ceiling, stopping the upstream response stream once the ceiling is consumed, and echoing the ceiling in the receipt so the caller can verify enforcement.

## Glossary

- **Gateway**: The v3 gateway service (`V3GatewayService`) that meters, calls upstream, and issues receipts.
- **Caller**: The agent or HTTP client sending a request through the Gateway.
- **Ceiling**: The maximum price in a named asset declared by the Caller via the `x-syncro-max-price` request header.
- **Asset**: The currency or token denomination of the Ceiling amount (e.g. `USDC`).
- **Minimum_Price**: The smallest possible charge for a route, equal to `priceStroops × 1` (one billable unit at the route's current rate-card price).
- **Reservation**: The quota hold the Gateway places on the agent meter before calling upstream, equal to `min(upperBoundStroops, ceilingStroops)` when a Ceiling is present.
- **Receipt**: The signed `PaidReceipt` payload issued by the Gateway after a successful call.
- **Parser**: The component that reads and validates the `x-syncro-max-price` header value.
- **Ceiling_Enforcer**: The component within the Gateway that checks, caps, and stops the upstream call according to the Ceiling.
- **Stroops**: The smallest unit of on-chain value used internally (1 XLM = 10 000 000 stroops). Prices and reservations are stored in stroops.
- **Rate_Card**: The active price schedule for a route, identified by `versionId`.

---

## Requirements

### Requirement 1: Parse the `x-syncro-max-price` header

**User Story:** As a Caller, I want to declare a price ceiling in a standard request header, so that the Gateway can enforce my budget without requiring me to know internal pricing units.

#### Acceptance Criteria

1. WHEN a request includes an `x-syncro-max-price` header, THE Parser SHALL accept values matching the pattern `<amount> <asset>` where `<amount>` is a positive decimal number and `<asset>` is a non-empty alphanumeric string (e.g. `"0.05 USDC"`).
2. WHEN a request includes an `x-syncro-max-price` header with a value that does not match the required pattern, THE Parser SHALL return a structured error with code `GATEWAY_INVALID_PRICE_CEILING` and HTTP status 400.
3. WHEN a request includes an `x-syncro-max-price` header with an `<amount>` of zero or a negative number, THE Parser SHALL return a structured error with code `GATEWAY_INVALID_PRICE_CEILING` and HTTP status 400.
4. WHEN a request includes an `x-syncro-max-price` header with an `<asset>` that is not supported by the Gateway, THE Parser SHALL return a structured error with code `GATEWAY_UNSUPPORTED_CEILING_ASSET` and HTTP status 422.
5. WHEN a request does not include an `x-syncro-max-price` header, THE Parser SHALL allow the request to proceed without a Ceiling.
6. THE Parser SHALL treat the `x-syncro-max-price` header as case-insensitive in its header name.
7. FOR ALL valid `x-syncro-max-price` header strings, parsing then formatting then parsing SHALL produce an equivalent Ceiling value (round-trip property).

---

### Requirement 2: Reject calls where the Minimum_Price exceeds the Ceiling

**User Story:** As a Caller, I want the Gateway to tell me immediately when my ceiling is below the route's minimum price, so that I am not charged for a call that cannot possibly succeed within my budget.

#### Acceptance Criteria

1. WHEN a Ceiling is present and the Minimum_Price for the matched route exceeds the Ceiling amount, THE Ceiling_Enforcer SHALL reject the request with HTTP status 402, error code `GATEWAY_PRICE_CEILING_EXCEEDED`, and a response body that includes both the Ceiling amount and the Minimum_Price.
2. WHEN the Ceiling_Enforcer rejects a call under this criterion, THE Gateway SHALL NOT place a meter Reservation and SHALL NOT call the upstream.
3. WHEN the Ceiling_Enforcer rejects a call under this criterion, THE Gateway SHALL NOT issue a Receipt.
4. WHEN a Ceiling is present and the Minimum_Price is less than or equal to the Ceiling amount, THE Ceiling_Enforcer SHALL allow the call to proceed to the reservation step.

---

### Requirement 3: Cap the meter Reservation at the Ceiling

**User Story:** As a Caller, I want the Gateway to never reserve more than my ceiling on my meter, so that my available balance is not over-committed.

#### Acceptance Criteria

1. WHEN a Ceiling is present and the route's `upperBoundStroops` exceeds the Ceiling converted to stroops, THE Ceiling_Enforcer SHALL set the Reservation amount to the Ceiling converted to stroops rather than `upperBoundStroops`.
2. WHEN a Ceiling is present and the route's `upperBoundStroops` is less than or equal to the Ceiling converted to stroops, THE Ceiling_Enforcer SHALL set the Reservation amount to `upperBoundStroops` as usual (the Ceiling does not inflate the reservation).
3. THE Ceiling_Enforcer SHALL apply the Reservation cap before the meter's `reserve` call, so that an `OverageError` from the meter reflects the capped amount, not the uncapped route maximum.

---

### Requirement 4: Stop the upstream response when the Ceiling is consumed

**User Story:** As a Caller, I want the Gateway to stop accumulating billable usage once my ceiling is reached mid-response, so that a variable-cost call never charges me more than I declared.

#### Acceptance Criteria

1. WHILE the Gateway is consuming a streaming upstream response, THE Ceiling_Enforcer SHALL track the running measured quantity and stop reading the response body when the projected charge would exceed the Ceiling.
2. WHEN the upstream response is stopped because the Ceiling was reached, THE Gateway SHALL commit the meter Reservation at the Ceiling amount (not the full response cost).
3. WHEN the upstream response is stopped because the Ceiling was reached, THE Gateway SHALL issue a Receipt for the amount equal to the Ceiling, with a `ceilingReached` flag set to `true`.
4. WHEN the upstream response completes before the Ceiling is reached, THE Gateway SHALL commit the meter Reservation at the actual measured amount as normal (the Ceiling has no effect on under-ceiling calls).
5. IF the upstream response produces a measured quantity of zero, THEN THE Gateway SHALL commit the Reservation at the Minimum_Price (one billable unit) even when a Ceiling is present.

---

### Requirement 5: Echo the Ceiling in the Receipt

**User Story:** As a Caller, I want the receipt to include the ceiling I declared, so that I can verify the Gateway respected my limit.

#### Acceptance Criteria

1. WHEN a Ceiling is present and the call produces a Receipt, THE Receipt SHALL include a `maxPrice` field containing the parsed Ceiling amount and asset exactly as the Caller declared them.
2. WHEN no Ceiling is present, THE Receipt SHALL omit the `maxPrice` field (absence indicates no ceiling was enforced).
3. WHEN a Ceiling is present and `ceilingReached` is `true`, THE Receipt SHALL include both `maxPrice` and `ceilingReached: true`.
4. WHEN a Ceiling is present and `ceilingReached` is `false` (call finished under ceiling), THE Receipt SHALL include `maxPrice` and omit `ceilingReached` or set it to `false`.
5. THE Gateway SHALL include the `maxPrice` field in the signed receipt payload so that it covers the ceiling declaration under the Ed25519 signature.

---

### Requirement 6: Error response shape for ceiling rejections

**User Story:** As a Caller, I want ceiling-related errors to be machine-readable and distinct from other error codes, so that my agent can automatically decide to retry with a higher ceiling or report the failure accurately.

#### Acceptance Criteria

1. THE Gateway SHALL use the error code `GATEWAY_PRICE_CEILING_EXCEEDED` exclusively for the case where a declared Ceiling is below the Minimum_Price for the route.
2. THE Gateway SHALL use the error code `GATEWAY_INVALID_PRICE_CEILING` exclusively for malformed or non-parseable `x-syncro-max-price` header values.
3. THE Gateway SHALL use the error code `GATEWAY_UNSUPPORTED_CEILING_ASSET` exclusively for Ceiling values whose asset denomination is not accepted by the Gateway.
4. WHEN returning any ceiling-related error, THE Gateway SHALL include in the response body: the error code, a human-readable `message`, and a `details` object that includes at minimum the offending header value or the Minimum_Price and Ceiling as applicable.
5. THE Gateway SHALL NOT reuse any existing error code (such as `GATEWAY_BAD_REQUEST` or `GATEWAY_METER_INSUFFICIENT`) for ceiling-specific rejection cases.
