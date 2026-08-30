# @syncro/sdk Changelog

All notable changes to the SDK are documented here.

Each release notes the minimum compatible backend version (`synchro`). If your backend is older than the listed minimum, upgrade the backend before upgrading the SDK.

---

## [Unreleased]

_Changes staged for the next release._

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
