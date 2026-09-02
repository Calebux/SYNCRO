# API Changelog

All notable API changes are documented here. Entries are grouped by backend version and tagged as **breaking** or **non-breaking**.

A change is **breaking** if it removes or renames an endpoint, removes or renames a required/optional field, changes a field's type, or alters authentication requirements. Everything else is **non-breaking**.

---

## [Unreleased]

### Non-breaking

- **v2 API** (`/api/v2`) — success envelope `{ data, meta }`, RFC 7807 Problem Details errors, and opaque cursor pagination. Contract: [docs/api/v2-envelope.md](./api/v2-envelope.md).
- `/api/v1` mounted as a frozen alias of existing v1 handlers. Unversioned `/api/*` is unchanged.

### Deprecated

- **Legacy v1 payloads** on unversioned `/api/*` and `/api/v1/*` — deprecated 2026-08-26, sunset **2027-02-26**. Migrate to `/api/v2`.

---

## [1.1.0] — 2026-05-29

### Non-breaking

- `GET /api/subscriptions` — added optional `tag` query parameter for filtering by custom tag.
- `POST /api/subscriptions` — `notes` field is now accepted (string, max 1000 chars).
- `GET /api/analytics/spend` — new endpoint returning monthly spend aggregates per currency.
- Webhook events: added `subscription.paused` and `subscription.resumed` event types.
- `GET /api/health` — response now includes `db_latency_ms` field.

### Breaking

_None._

---

## [1.0.0] — 2026-04-01

Initial stable release.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/subscriptions` | Create a subscription |
| `GET` | `/api/subscriptions` | List subscriptions (paginated) |
| `GET` | `/api/subscriptions/:id` | Get a subscription |
| `PATCH` | `/api/subscriptions/:id` | Update a subscription |
| `DELETE` | `/api/subscriptions/:id` | Delete a subscription |
| `POST` | `/api/webhooks` | Register a webhook |
| `GET` | `/api/webhooks` | List webhooks |
| `DELETE` | `/api/webhooks/:id` | Delete a webhook |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/analytics/spend` | Spend analytics |

### Authentication

All routes require a bearer token (`Authorization: Bearer <token>`) or an API key (`x-api-key` header). See [authentication.mdx](./authentication.mdx).

---

## How to Add an Entry

When opening a PR that changes the API:

1. Add an entry under `[Unreleased]` in this file.
2. Tag it `**breaking**` or `**non-breaking**`.
3. For breaking changes, also update [deprecation-policy.md](./deprecation-policy.md) if a migration window applies.
4. On release, move `[Unreleased]` entries to a new versioned section.
