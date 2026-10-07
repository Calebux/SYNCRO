# @syncro/sdk Changelog

## 4.0.0

### Major Changes

- f9d9809: v3 major release: subscription APIs removed, clean break from previous major.
  The `@syncro/sdk` package now ships the v3 payments surface only.
  Subscription CRUD, analytics, notification, and gift-card APIs have been removed.
  The `@syncro/sdk/v3` sub-path provides the x402 payments API (GatewayClient,
  createPaidFetch, receipt verification, retry, gateway errors).
  See `sdk/README.md` for the v3 quickstart and migration notes.

### Patch Changes

- Updated dependencies [f9d9809]
  - @syncro/shared@1.0.1

All notable changes to the SDK are documented here.

Each release notes the minimum compatible backend version (`synchro`). If your backend is older than the listed minimum, upgrade the backend before upgrading the SDK.

---

## [Unreleased]

_Changes staged for the next release._

---

## [3.0.0] — 2026-08-26

### Breaking — subscription APIs removed

- The subscription SDK surface has been **removed** from `@syncro/sdk`. This is a clean break, not a deprecation.
- `createSubscription`, `listSubscriptions`, `getSubscription`, `updateSubscription`, `deleteSubscription`, `getUserSubscriptions`, `getAnalyticsSummary`, `getRenewalHistory`, `createWebhook`, `listWebhooks`, `deleteWebhook`, `getNotifications`, `markNotificationRead`, `attachGiftCard`, `cancelSubscription`, and the `SyncroSDK` class no longer exist.
- `SyncroSDKConfig`, `SyncroSDKInitConfig`, and all subscription-related types have been removed.
- The deprecated error aliases (`AuthenticationError`, `ForbiddenError`, `RateLimitError`, `ConflictError`) have been removed.
- Subscription-related Soroban contract bindings (`buildSubscriptionRegistryCreateSubscription`, etc.) have been removed.
- **There is no upgrade path from the subscription SDK to v3.** The subscription API and the v3 payments API are not compatible; there is no shim, adapter, or codemod. Existing subscription integrations must be rewritten against the v3 payments surface.

### Added — v3 payments surface

- `@syncro/sdk/v3` sub-path provides the x402 payments API: `GatewayClient`, `createPaidFetch`, receipt verification, retry utilities, and gateway error taxonomy.
- `GatewayClient` — HTTP client with idempotency-key support and automatic 402 payment handling.
- `createPaidFetch` — drop-in `fetch` wrapper that handles HTTP 402 (payment required) challenges.
- `verifyReceipt` / `decodeReceiptHeader` — verify Soroban payment receipts with Ed25519 signatures.
- `LogicalCallManager` — idempotency-key-aware retry manager for gateway calls.
- Full gateway error taxonomy (`GatewaySdkError`, `GatewayPaymentRequiredError`, etc.) generated from backend taxonomy.

### Migration

- Existing subscription integrations must be rewritten against the v3 payments API. See `sdk/README.md` for the v3 quickstart.
- The v3 payments API is accessed via `@syncro/sdk/v3` or the top-level `@syncro/sdk` exports.

### Deprecated — final v1.x release

- The previous major (`@syncro/sdk` v1.x) carried subscription APIs. The final v1.x release is **1.1.0**. Users on v1.x should migrate to v3; no further v1.x patches are planned.

---

## [1.1.0] — 2026-05-29

**Requires backend:** `synchro` ≥ 1.0.0

### Added

- `listSubscriptions({ tag })` — filter by custom tag (maps to `GET /api/subscriptions?tag=`).
- `createSubscription({ notes })` — optional `notes` field now forwarded to the API.
- `getSpendAnalytics()` — new method wrapping `GET /api/analytics/spend`.
- Webhook event types `subscription.paused` and `subscription.resumed` are now included in the `WebhookEvent` union type.
- `SyncroSDK.healthCheck()` — response type now includes `db_latency_ms: number`.

### Changed

- Logger output now includes the SDK version in every log line for easier debugging.

### Fixed

- Retry logic no longer retries on `400 Bad Request` responses (only `429` and `5xx`).

---

## [1.0.0] — 2026-04-01

**Requires backend:** `synchro` ≥ 1.0.0

Initial stable release.

### Added

- `SyncroSDK` class with configurable `apiKey`, `baseUrl`, `timeout`, and `retries`.
- `createSubscription(payload)` — `POST /api/subscriptions`
- `listSubscriptions(filters?)` — `GET /api/subscriptions`
- `getSubscription(id)` — `GET /api/subscriptions/:id`
- `updateSubscription(id, patch)` — `PATCH /api/subscriptions/:id`
- `deleteSubscription(id)` — `DELETE /api/subscriptions/:id`
- `createWebhook(payload)` — `POST /api/webhooks`
- `listWebhooks()` — `GET /api/webhooks`
- `deleteWebhook(id)` — `DELETE /api/webhooks/:id`
- `healthCheck()` — `GET /api/health`
- `SyncroError` class with `statusCode` and `message` fields.
- Exponential backoff retry on `429` and `5xx` responses (configurable via `retries`).
- Structured logger (opt-in via `logger` config option).
- Batch operations helper with configurable concurrency limit.

---

## How to Add an Entry

1. Add changes under `[Unreleased]` using the sections `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`.
2. Always note the minimum compatible backend version.
3. For breaking changes, also update [docs/deprecation-policy.md](../docs/deprecation-policy.md).
4. On release, rename `[Unreleased]` to the new version with today's date.
