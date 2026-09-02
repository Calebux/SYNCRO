# @syncro/sdk Changelog

## 1.2.0

### Minor Changes

- f9d9809: Dual ESM/CJS SDK builds with subpath exports, generated database and contract types, and changeset-driven releases.

### Patch Changes

- Updated dependencies [f9d9809]
  - @syncro/shared@1.1.0

All notable changes to the SDK are documented here.

Each release notes the minimum compatible backend version (`synchro`). If your backend is older than the listed minimum, upgrade the backend before upgrading the SDK.

---

## [Unreleased]

_Changes staged for the next release._

### Added — #1303 Typed error taxonomy

- `ValidationError` — stable code `SYNCRO_VALIDATION`, retryable: `false`
- `AuthError` — stable code `SYNCRO_AUTH`, retryable: `false` (replaces `AuthenticationError`, `ForbiddenError`)
- `NetworkError` — stable code `SYNCRO_NETWORK`, retryable: `true`
- `RpcError` — stable code `SYNCRO_RPC`, retryable: `true`
- `ContractError` — stable code `SYNCRO_CONTRACT`, retryable: `false`; exposes `.contractName`, `.errorCode`, `.variant` (resolved from `CONTRACT_ERROR_REGISTRY`)
- `withRetry(fn, policy?, idempotencyKey?)` — exponential backoff with jitter; refuses to retry non-retryable classes; blocks non-idempotent submissions beyond the first attempt without an `idempotencyKey`
- `computeBackoffDelay(attempt, policy)` — compute the delay for a given attempt
- `resolveContractErrorVariant(contractName, code)` — look up a contract error variant name by integer code

### Added — #1299 Public API surface

- `sdk/api-surface.md` committed to the repo, listing every public export
- `sdk/scripts/check-api-surface.cjs` — CI script that fails when a new export is not in the report
- `npm run check:api-surface -w sdk` build step added to `prepublishOnly`
- Semver and deprecation policy documented in `sdk/README.md`
- Experimental API guidance added to README (sub-path `./experimental`)

### Added — #1300 WASM contract bindings in CI

- `generate-contract-bindings.cjs` now stamps a `CONTRACT_BINDINGS_VERSION` constant in every generated file
- `--wasm-dir` flag scans a directory of `.wasm` artifacts and generates bindings from the live ABI
- `--check` flag compares the committed hash to a freshly computed one; CI exits non-zero on mismatch
- Four new CI jobs in `contracts.yml`: `check-bindings-stale`, `regenerate-bindings-from-wasm`, `verify-version-stamp`, `check-api-surface`

### Added — #1304 Soroban sandbox integration suite

- `sdk/tests/integration/soroban-sandbox.test.ts` — 7 flows covering register agent, create subscription on-chain, renew, read events, verify receipt (memo round-trip), failure flow with decoded `ContractError`, and contract signature change detection
- `sdk/scripts/run-integration.sh` — single-command script that starts a Docker sandbox, deploys all contracts, regenerates bindings, and runs the integration suite
- `npm run test:integration -w sdk` documented local command
- `sdk-integration` CI job added to `test.yml` (runs on `run-integration` PR label or `force_full_run` dispatch)

### Deprecated

- `AuthenticationError` — use `AuthError` instead (will be removed in v2.0)
- `ForbiddenError` — use `AuthError` instead (will be removed in v2.0)
- `ConflictError` — use `ValidationError` instead (will be removed in v2.0)
- `RateLimitError` — use `NetworkError` instead (will be removed in v2.0)

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
