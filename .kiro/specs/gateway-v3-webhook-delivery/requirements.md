# Requirements Document

## Introduction

The v3 gateway emits events across the paid-call and channel lifecycle, but no delivery service yet exists to push those events to external systems. This feature builds a first-class **v3 webhook delivery service** that is entirely separate from the existing v2 `WebhookService` (which is scoped to user-level subscription events and is not modified here).

The v3 service targets **principal** and **provider** entities. A principal or provider registers one or more HTTPS endpoints, subscribes each endpoint to a subset of the seven v3 event types, and receives signed HTTP POST deliveries whenever a matching event fires. Deliveries are signed with HMAC-SHA256 hex over the raw JSON body — exactly the algorithm `verifyWebhookSignature` in the SDK uses — so a receiver can drop `createWebhookHandler` from the SDK onto any endpoint and verify real deliveries with no extra integration work.

Failed deliveries retry with exponential backoff, dead-letter after a configured maximum attempt count, and can be manually requeued for redelivery. Endpoints that accumulate consecutive failures beyond a threshold are automatically disabled and can be manually re-enabled. Every attempt — success or failure — is written to a durable delivery log.

## Glossary

- **Delivery_Service**: The v3 webhook delivery service (`V3WebhookDeliveryService`) built by this feature. Distinct from, and does not extend, the v2 `WebhookService`.
- **Endpoint**: A registered HTTPS URL owned by a Principal or Provider, with its own secret and event-subscription list. Stored in `v3_webhook_endpoints`.
- **Owner**: The principal or provider that registered an Endpoint. Each Endpoint belongs to exactly one Owner.
- **Principal**: A human or organisation account in the v3 gateway whose spending authority covers one or more Agents.
- **Provider**: A registered API provider in the v3 gateway who owns routes and rate cards.
- **V3_Event_Type**: One of the seven event types the Delivery_Service can deliver: `paid_call.completed`, `paid_call.failed`, `channel.opened`, `channel.closed`, `channel.low_balance`, `provider.route_revised`, `test.ping`.
- **Subscription_List**: The ordered set of `V3_Event_Type` values an Endpoint has opted into. Only events matching the Subscription_List are delivered to that Endpoint.
- **Secret**: A `whsec_`-prefixed random string generated at Endpoint registration. Used as the HMAC-SHA256 key for signing deliveries. Never returned after the creation response.
- **Envelope**: The JSON object delivered as the HTTP POST body. Contains `id`, `type`, `created`, and `data` fields. `id` is the stable event identifier; `type` is the `V3_Event_Type`.
- **Delivery_Attempt**: One HTTP POST to an Endpoint's URL carrying an Envelope. Recorded in `v3_webhook_delivery_attempts`.
- **Delivery_Id**: A UUID assigned to a Delivery_Attempt, sent in the `x-syncro-delivery-id` header.
- **Retry_Count**: The number of previous failed attempts for this delivery, sent in the `x-syncro-retry-count` header. Zero on the first attempt.
- **Replay_Id**: A stable UUID assigned at the time an event is queued for redelivery. Sent in `x-syncro-replay-id` on redelivered attempts. Absent on original (non-replay) deliveries.
- **Signature**: The lowercase hex HMAC-SHA256 digest of the raw JSON body, keyed with the Endpoint's Secret. Sent in `x-syncro-signature`. Matches the value `verifyWebhookSignature` in the SDK checks.
- **Dead_Letter**: A Delivery_Attempt that has been moved to dead-letter state after exhausting retries. Stored with `is_dead_letter = true` on the attempt row.
- **Redelivery**: A manually triggered Delivery_Attempt for a Dead_Letter, identified by a stable Replay_Id for idempotency.
- **Failure_Count**: The rolling count of consecutive failed Delivery_Attempts for an Endpoint. Resets to zero on any successful delivery.
- **Disable_Threshold**: The configured maximum Failure_Count before the Endpoint is automatically disabled. Default: 10 consecutive failures.
- **SSRF_Guard**: The outbound URL validation check (DNS-resolving, applied at delivery time) that blocks deliveries to private, loopback, link-local, and metadata-service IP ranges.
- **SDK**: The `@syncro/sdk` package. `createWebhookHandler`, `parseVerifiedWebhookEvent`, and `verifyWebhookSignature` are the SDK functions that consume deliveries from this service.

---

## Requirements

### Requirement 1: Endpoint registration

**User Story:** As a Principal or Provider, I want to register one or more HTTPS webhook endpoints and choose which v3 event types each endpoint receives, so that I can direct different event streams to different services.

#### Acceptance Criteria

1. WHEN a Principal or Provider submits a valid registration request containing a `url` and a non-empty `events` array, THE Delivery_Service SHALL create an Endpoint, generate a unique Secret with the `whsec_` prefix, persist both, and return the Endpoint record including the Secret in the creation response.
2. THE Delivery_Service SHALL NOT return the Secret in any subsequent read, list, or update response — only in the creation response.
3. WHEN a registration request is submitted with a `url` that does not use the `https` scheme, THE Delivery_Service SHALL reject the request with HTTP 400.
4. WHEN a registration request is submitted with an `events` array that is empty, THE Delivery_Service SHALL reject the request with HTTP 400.
5. WHEN a registration request is submitted with an `events` array containing a string that is not one of the seven `V3_Event_Type` values, THE Delivery_Service SHALL reject the request with HTTP 400 and include the unrecognised value in the error response.
6. THE Delivery_Service SHALL allow a single Principal or Provider to register up to 20 Endpoints; a registration that would exceed this limit SHALL be rejected with HTTP 422.
7. WHEN an Endpoint is created, THE Delivery_Service SHALL set `enabled = true` and `failure_count = 0`.
8. FOR ALL Endpoints, the Secret generated at registration SHALL be a cryptographically random value of at least 24 bytes encoded as `whsec_<hex>`, matching the prefix convention used by the v2 `WebhookService`.

---

### Requirement 2: Endpoint management (read, update, delete, re-enable)

**User Story:** As a Principal or Provider, I want to list, update, delete, and re-enable my webhook endpoints, so that I can keep my endpoint configuration current as my system evolves.

#### Acceptance Criteria

1. WHEN a Principal or Provider requests a list of their Endpoints, THE Delivery_Service SHALL return all Endpoints owned by that Owner, ordered by `created_at` descending, with Secret omitted.
2. WHEN a Principal or Provider updates an Endpoint they own by supplying a new `url`, `events`, or `enabled` flag, THE Delivery_Service SHALL apply the change and return the updated record.
3. WHEN an update request changes `enabled` from `false` to `true`, THE Delivery_Service SHALL also reset `failure_count` to 0.
4. WHEN a Principal or Provider deletes an Endpoint, THE Delivery_Service SHALL soft-delete the record and SHALL NOT deliver any further events to that Endpoint.
5. WHEN a Principal or Provider attempts to read, update, or delete an Endpoint owned by a different Owner, THE Delivery_Service SHALL respond with HTTP 404.
6. WHEN an update request sets `events` to an empty array, THE Delivery_Service SHALL reject the request with HTTP 400.
7. WHEN an update request sets `url` to a non-HTTPS URL, THE Delivery_Service SHALL reject the request with HTTP 400.

---

### Requirement 3: V3 event type catalogue

**User Story:** As a Principal or Provider, I want to subscribe to any combination of the seven v3 gateway event types, so that my system receives exactly the events relevant to its function.

#### Acceptance Criteria

1. THE Delivery_Service SHALL support exactly the following seven `V3_Event_Type` values as valid subscription targets: `paid_call.completed`, `paid_call.failed`, `channel.opened`, `channel.closed`, `channel.low_balance`, `provider.route_revised`, `test.ping`.
2. WHEN a `paid_call.completed` event fires, THE Delivery_Service SHALL include in the Envelope `data` field: `receipt_id`, `channel_id`, `route`, `quantity`, `amount_stroops`, `rate_card_version`, and `settled_at`.
3. WHEN a `paid_call.failed` event fires, THE Delivery_Service SHALL include in the Envelope `data` field: `receipt_id`, `channel_id`, `route`, `failure_reason`, and `failed_at`.
4. WHEN a `channel.opened` event fires, THE Delivery_Service SHALL include in the Envelope `data` field: `channel_id`, `principal_id`, `provider_id`, `initial_balance_stroops`, and `opened_at`.
5. WHEN a `channel.closed` event fires, THE Delivery_Service SHALL include in the Envelope `data` field: `channel_id`, `principal_id`, `provider_id`, `final_balance_stroops`, and `closed_at`.
6. WHEN a `channel.low_balance` event fires, THE Delivery_Service SHALL include in the Envelope `data` field: `channel_id`, `principal_id`, `current_balance_stroops`, `threshold_stroops`, and `measured_at`.
7. WHEN a `provider.route_revised` event fires, THE Delivery_Service SHALL include in the Envelope `data` field: `provider_id`, `route_id`, `path_pattern`, `method`, `new_price_stroops`, `rate_card_version`, and `effective_from`.
8. WHEN a `test.ping` event fires, THE Delivery_Service SHALL include in the Envelope `data` field: `message` (a human-readable string set by the caller) and `initiated_by` (the entity ID that triggered the ping).
9. FOR ALL V3_Event_Type values, the Envelope SHALL conform to the structure `{ id: string, type: V3_Event_Type, created: number (Unix epoch seconds), data: object }`, matching the `SyncroWebhookEnvelope` interface in the SDK.

---

### Requirement 4: Signed payload delivery

**User Story:** As a Principal or Provider, I want every delivery to carry a verifiable HMAC-SHA256 signature and standard delivery metadata headers, so that my endpoint can confirm the payload is authentic and was not tampered with in transit.

#### Acceptance Criteria

1. WHEN the Delivery_Service sends a Delivery_Attempt, THE Delivery_Service SHALL set the `x-syncro-signature` header to the lowercase hex HMAC-SHA256 digest of the raw JSON body, keyed with the Endpoint's Secret.
2. WHEN the Delivery_Service sends a Delivery_Attempt, THE Delivery_Service SHALL set the `x-syncro-delivery-id` header to the Delivery_Id UUID for that attempt.
3. WHEN the Delivery_Service sends a Delivery_Attempt that is not a Redelivery, THE Delivery_Service SHALL set the `x-syncro-retry-count` header to the number of previous failed attempts for this delivery (0 on the first attempt, 1 on the first retry, etc.).
4. WHEN the Delivery_Service sends a Redelivery, THE Delivery_Service SHALL set the `x-syncro-replay-id` header to the stable Replay_Id for that redelivery; `x-syncro-replay-id` SHALL be absent on original (non-replay) deliveries.
5. WHEN the Delivery_Service sends a Delivery_Attempt, THE Delivery_Service SHALL set `Content-Type: application/json` and `User-Agent: Syncro-Webhooks/1.0`.
6. FOR ALL Delivery_Attempts, calling `verifyWebhookSignature(rawBody, headers['x-syncro-signature'], endpointSecret)` from the SDK SHALL return `true`, where `rawBody` is the exact byte sequence transmitted as the POST body.
7. FOR ALL Delivery_Attempts, calling `parseVerifiedWebhookEvent(rawBody, headers, endpointSecret)` from the SDK SHALL return a non-null `SyncroWebhookEvent` whose `type` field matches the `V3_Event_Type` of the event that triggered the delivery.
8. THE Delivery_Service SHALL serialize the Envelope to JSON using a stable serialization (no randomized key ordering) so that the byte sequence passed to HMAC-SHA256 matches the byte sequence received by the endpoint.

---

### Requirement 5: Retry with exponential backoff

**User Story:** As a Principal or Provider, I want failed deliveries to be automatically retried with exponential backoff, so that transient endpoint downtime does not result in permanently lost events.

#### Acceptance Criteria

1. WHEN a Delivery_Attempt receives a non-2xx HTTP response or a network error, THE Delivery_Service SHALL schedule a retry with a delay equal to `30 × 2^(retryNumber - 1)` seconds, where `retryNumber` is 1 for the first retry, 2 for the second, and so on; the resulting delays are 30 s, 60 s, 120 s, 240 s, and 480 s for retries 1–5.
2. THE Delivery_Service SHALL attempt a maximum of 5 retries (6 total attempts including the first) before moving the delivery to Dead_Letter.
3. WHEN a retry is scheduled, THE Delivery_Service SHALL record the `scheduled_at` timestamp on the Delivery_Attempt row and SHALL NOT attempt delivery before that time.
4. WHEN a retry fires, THE Delivery_Service SHALL send the identical Envelope body as the original attempt and SHALL increment the `x-syncro-retry-count` header by 1 relative to the previous attempt.
5. WHEN a Delivery_Attempt succeeds (2xx response), THE Delivery_Service SHALL mark the delivery `succeeded`, record the response code and a response body excerpt (up to 1 000 characters), set `delivered_at`, and cancel any scheduled retries for that delivery.
6. WHEN a Delivery_Attempt returns HTTP 410 (Gone), THE Delivery_Service SHALL treat the response as a permanent failure, skip further retries, move the delivery to Dead_Letter immediately, and record the reason as `endpoint_gone`.
7. FOR ALL retry sequences, the `x-syncro-retry-count` header on the Nth retry SHALL equal N (invariant: retry-count header equals attempt number minus one).

---

### Requirement 6: Endpoint auto-disable after repeated failures

**User Story:** As an Operator, I want an endpoint that repeatedly fails to be automatically disabled after a configurable threshold, so that the delivery queue does not accumulate unbounded retries for a permanently unreachable endpoint.

#### Acceptance Criteria

1. WHEN a Delivery_Attempt for an Endpoint fails, THE Delivery_Service SHALL increment the Endpoint's `failure_count` by 1.
2. WHEN a Delivery_Attempt for an Endpoint succeeds, THE Delivery_Service SHALL reset the Endpoint's `failure_count` to 0.
3. WHEN the Endpoint's `failure_count` reaches the Disable_Threshold (default: 10 consecutive failures), THE Delivery_Service SHALL set `enabled = false` on the Endpoint and SHALL NOT dispatch any further Delivery_Attempts to that Endpoint until it is re-enabled.
4. WHEN an Endpoint is auto-disabled, THE Delivery_Service SHALL emit an audit event of type `v3_webhook.endpoint_auto_disabled` recording the `endpoint_id`, `owner_id`, and `failure_count`.
5. WHEN an Owner re-enables a disabled Endpoint by setting `enabled = true`, THE Delivery_Service SHALL reset `failure_count` to 0 and resume dispatching Delivery_Attempts for new events.
6. WHILE an Endpoint is disabled, THE Delivery_Service SHALL skip that Endpoint when dispatching events; events that fire while an Endpoint is disabled SHALL NOT be queued for later delivery to that Endpoint.
7. THE Disable_Threshold SHALL be configurable via environment variable `V3_WEBHOOK_DISABLE_THRESHOLD`; if the variable is absent or not a positive integer, THE Delivery_Service SHALL default to 10.

---

### Requirement 7: Delivery log

**User Story:** As a Principal or Provider, I want to query a log of all delivery attempts for my endpoints, so that I can audit event delivery status, debug failures, and identify patterns.

#### Acceptance Criteria

1. THE Delivery_Service SHALL record every Delivery_Attempt in `v3_webhook_delivery_attempts` with: `delivery_id` (UUID), `endpoint_id`, `event_type`, `envelope` (the full JSON payload), `status` (`pending` | `succeeded` | `failed` | `retrying` | `dead_letter`), `response_code` (nullable), `response_body_excerpt` (up to 1 000 characters, nullable), `retry_count`, `scheduled_at`, `delivered_at` (nullable), `is_dead_letter`, and `created_at`.
2. WHEN a Principal or Provider queries the delivery log for one of their Endpoints, THE Delivery_Service SHALL return Delivery_Attempts ordered by `created_at` descending, paginated, with a default page size of 50 and a maximum of 200.
3. WHEN a Principal or Provider queries the delivery log with a `status` filter, THE Delivery_Service SHALL return only Delivery_Attempts whose `status` matches the filter.
4. WHEN a Principal or Provider attempts to query the delivery log for an Endpoint owned by a different Owner, THE Delivery_Service SHALL respond with HTTP 404.
5. THE Delivery_Service SHALL retain Delivery_Attempt rows for at least 90 days before they become eligible for archival.
6. WHEN a Delivery_Attempt is updated (e.g., from `retrying` to `succeeded`), THE Delivery_Service SHALL record the final `response_code` and `response_body_excerpt` on the existing row rather than inserting a new row.

---

### Requirement 8: Dead-letter and manual redelivery

**User Story:** As a Principal or Provider, I want to view dead-lettered deliveries and manually trigger redelivery for a specific one, so that I can recover from extended endpoint outages without losing events permanently.

#### Acceptance Criteria

1. WHEN a Delivery_Attempt exhausts all retries without a successful response, THE Delivery_Service SHALL mark `is_dead_letter = true`, set `dead_letter_at` to the current timestamp, set `dead_letter_reason` to a string describing the last failure, and set `status = dead_letter`.
2. WHEN a Principal or Provider requests redelivery of a Dead_Letter, THE Delivery_Service SHALL create a Redelivery record keyed by a stable `replay_id` UUID, set its status to `pending`, and return the record.
3. WHEN a Redelivery is created with a `replay_id` that already exists, THE Delivery_Service SHALL return the existing Redelivery record without creating a duplicate (idempotency by `replay_id`).
4. WHEN a Redelivery is executed, THE Delivery_Service SHALL send the identical Envelope body as the original Delivery_Attempt, include the `x-syncro-replay-id` header set to the `replay_id`, and record the outcome in the Redelivery record.
5. WHEN a Redelivery succeeds, THE Delivery_Service SHALL update the original Dead_Letter's `status` to `succeeded` and set `delivered_at`.
6. IF a Redelivery attempt fails, THEN THE Delivery_Service SHALL record the failure in the Redelivery record but SHALL NOT automatically retry the Redelivery; each Redelivery attempt requires an explicit manual request.
7. WHEN a Principal or Provider queries dead-lettered deliveries for one of their Endpoints, THE Delivery_Service SHALL return only rows where `is_dead_letter = true`, ordered by `dead_letter_at` descending.
8. FOR ALL Redeliveries, the `replay_id` SHALL remain stable across repeated redelivery attempts for the same Dead_Letter, so that receivers can deduplicate using `x-syncro-replay-id`.

---

### Requirement 9: SSRF protection on outbound delivery

**User Story:** As an Operator, I want all outbound delivery requests to be blocked if the resolved target IP is a private, loopback, link-local, or cloud-metadata address, so that a malicious or misconfigured endpoint URL cannot be used to probe internal infrastructure.

#### Acceptance Criteria

1. WHEN the Delivery_Service is about to send a Delivery_Attempt, THE SSRF_Guard SHALL resolve the hostname in the Endpoint's URL to an IP address and reject the delivery if the IP falls within any RFC 1918 private range (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), the loopback range (127.0.0.0/8), the link-local range (169.254.0.0/16), or the IPv6 loopback (::1).
2. WHEN the SSRF_Guard blocks a Delivery_Attempt, THE Delivery_Service SHALL record the attempt as `failed` with `dead_letter_reason = 'ssrf_blocked'`, SHALL NOT retry the delivery, and SHALL emit an audit event of type `v3_webhook.ssrf_blocked` recording `endpoint_id`, `url`, and the blocked reason.
3. WHEN the SSRF_Guard blocks a Delivery_Attempt on a Redelivery, THE Delivery_Service SHALL record the Redelivery as `failed` and emit the same `v3_webhook.ssrf_blocked` audit event.
4. WHEN a registration or update request is submitted, THE Delivery_Service SHALL perform a static URL validation (scheme must be `https`, host must not be `localhost`, host must not be a bare IP address in a private range) as a first-pass check, in addition to the DNS-resolving check at delivery time.
5. WHEN the SSRF_Guard check is performed at delivery time, THE check SHALL re-resolve the hostname via DNS, not rely on the IP cached at registration time, to protect against DNS rebinding attacks.

---

### Requirement 10: SDK integration test

**User Story:** As an Engineer, I want an integration test that uses `createWebhookHandler` from the SDK to receive and verify a real delivery produced by the Delivery_Service, so that any regression in the signing contract is caught before release.

#### Acceptance Criteria

1. THE integration test SHALL start a local HTTPS (or HTTP for test purposes) server that uses `createWebhookHandler(secret, handlers)` from the SDK to receive deliveries.
2. WHEN the Delivery_Service delivers a `test.ping` event to the test server, THE SDK's `createWebhookHandler` SHALL return HTTP 200, confirming that `verifyWebhookSignature` passed for the delivered payload.
3. WHEN the Delivery_Service delivers any V3_Event_Type with a tampered body (body differs from what was signed), THE SDK's `createWebhookHandler` SHALL return HTTP 401, confirming the signature check rejects the tampered payload.
4. THE integration test SHALL verify that the `x-syncro-delivery-id`, `x-syncro-retry-count`, and `x-syncro-signature` headers are all present on the delivered request.
5. WHEN the Delivery_Service delivers a Redelivery, THE integration test SHALL verify that the `x-syncro-replay-id` header is present and matches the `replay_id` from the Redelivery record.
6. THE integration test SHALL assert that `parseVerifiedWebhookEvent(rawBody, headers, secret)` returns a non-null event whose `type` matches the dispatched V3_Event_Type, confirming full end-to-end parse-and-verify compatibility with the SDK.

---

### Requirement 11: Failed deliveries retry and dead-letter (integration acceptance criterion)

**User Story:** As a Principal or Provider, I want to observe that a delivery to a consistently failing endpoint retries the configured number of times and then appears in the dead-letter queue, so that I can verify the full retry-to-dead-letter lifecycle.

#### Acceptance Criteria

1. WHEN an endpoint returns HTTP 500 on every attempt, THE Delivery_Service SHALL record exactly 6 Delivery_Attempts (1 original + 5 retries) before marking the delivery as dead-lettered.
2. WHEN the final retry fails and the delivery is dead-lettered, THE Delivery_Service SHALL set `is_dead_letter = true` and `dead_letter_at` on the Delivery_Attempt row.
3. WHEN a delivery is dead-lettered, THE Delivery_Service SHALL make the delivery visible in the dead-letter query for that Endpoint's Owner.
4. WHEN the Owner triggers a manual Redelivery for the dead-lettered delivery and the endpoint now returns HTTP 200, THE Delivery_Service SHALL mark the Redelivery as `succeeded` and update the original Dead_Letter's `status` to `succeeded`.
5. FOR ALL dead-lettered deliveries, every intermediate attempt SHALL be recorded in the delivery log with the correct `retry_count` value (0, 1, 2, 3, 4, 5 respectively).

---

### Requirement 12: Property-test invariant — signature round-trip

**User Story:** As an Engineer, I want a property test to verify that for any Envelope body the Delivery_Service produces, `verifyWebhookSignature` from the SDK returns `true` using the same secret, so that the HMAC computation in the backend and the SDK stay in sync.

#### Acceptance Criteria

1. FOR ALL valid `V3_Event_Type` values and FOR ALL valid Envelope payloads, the HMAC-SHA256 hex digest of `JSON.stringify(envelope)` keyed with the Endpoint's Secret SHALL equal the value that `verifyWebhookSignature(JSON.stringify(envelope), signature, secret)` accepts as valid (round-trip property).
2. FOR ALL Envelopes, changing any single byte of the serialised JSON body SHALL cause `verifyWebhookSignature` to return `false` (tamper-detection property).
3. FOR ALL Endpoints, the Secret generated at registration SHALL pass `verifyWebhookSignature` without modification; no encoding conversion (e.g. base64 to hex) SHALL be required between the stored Secret and the value passed to HMAC (key-storage fidelity property).
