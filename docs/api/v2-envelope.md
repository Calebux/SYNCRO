# SYNCRO API v2 — Response envelope, errors, and pagination

This is the **v2 HTTP contract**. Clients (including generated SDKs) parse every
`/api/v2` response with these shapes. Handlers return domain values; the router
registry wraps them into this envelope.

Version prefix: **`/api/v2`**. Unversioned `/api/*` and `/api/v1/*` keep the
legacy v1 shapes. See [v1 deprecation](#v1-deprecation-timeline).

---

## Success envelope

Every successful v2 response is a JSON object with `data` and `meta`. List
endpoints also include `pagination`.

```json
{
  "data": { "id": "sub_01", "name": "Netflix", "price": 15.99 },
  "meta": {
    "request_id": "req_7c2a1e",
    "version": "v2"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | object \| array \| null | yes | Domain payload. Never wrapped in `{ success }`. |
| `meta.request_id` | string | yes | Correlation id (same value as `x-request-id`). |
| `meta.version` | `"v2"` | yes | Envelope version. |
| `pagination` | object | lists only | See [Cursor pagination](#cursor-pagination). |

Empty bodies (204) are not used. Deletes return `data: null` with HTTP 200.

### List example

```json
{
  "data": [
    { "id": "sub_01", "name": "Netflix", "created_at": "2026-08-01T12:00:00.000Z" },
    { "id": "sub_02", "name": "Spotify", "created_at": "2026-07-20T09:00:00.000Z" }
  ],
  "pagination": {
    "next_cursor": "v2c.AAAA.opaque-token",
    "has_more": true,
    "limit": 20
  },
  "meta": {
    "request_id": "req_7c2a1e",
    "version": "v2"
  }
}
```

`pagination.next_cursor` is `null` when `has_more` is `false`.

---

## Error envelope (RFC 7807 Problem Details)

Failures use `Content-Type: application/problem+json` and the RFC 7807 / RFC 9457
members. v2 adds `request_id` as an extension member.

```json
{
  "type": "https://syncro.app/problems/validation",
  "title": "Validation Error",
  "status": 400,
  "detail": "The request input failed validation.",
  "instance": "/api/v2/subscriptions",
  "request_id": "req_7c2a1e"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | URI | yes | Stable problem type. |
| `title` | string | yes | Short, stable summary. |
| `status` | integer | yes | HTTP status; matches the response status. |
| `detail` | string | yes | Occurrence-specific explanation. |
| `instance` | string | yes | Request path. |
| `request_id` | string | yes | Correlation id. |
| `errors` | array | validation only | `{ "field": "limit", "message": "..." }` entries. |

Registered problem types:

| Type | Status | When |
|------|--------|------|
| `https://syncro.app/problems/validation` | 400 | Body, query, or path failed schema checks. |
| `https://syncro.app/problems/invalid-cursor` | 400 | `cursor` failed signature or structural validation. |
| `https://syncro.app/problems/unauthorized` | 401 | Missing or invalid credentials. |
| `https://syncro.app/problems/forbidden` | 403 | Authenticated but not allowed. |
| `https://syncro.app/problems/not-found` | 404 | Resource does not exist. |
| `https://syncro.app/problems/conflict` | 409 | State conflict (duplicate, stale etag). |
| `https://syncro.app/problems/rate-limit` | 429 | Too many requests. |
| `https://syncro.app/problems/internal` | 500 | Unexpected failure. |

---

## Cursor pagination

v2 lists are **cursor-based**. Offset/`page` query parameters are rejected.

### Query

| Param | Type | Default | Rules |
|-------|------|---------|-------|
| `limit` | integer | `20` | Inclusive range `[1, 100]`. |
| `cursor` | string | omitted | Opaque token from a previous `pagination.next_cursor`. |

Invalid `limit` or `cursor` → `400` with `invalid-cursor` or `validation`.

### Cursor properties

1. **Opaque.** Clients MUST pass the token back unchanged. The encoding is not
   part of the contract and may change without notice.
2. **Signed.** The server rejects tampered or truncated tokens.
3. **Stable under insertion.** The cursor is a keyset of `(created_at, id)`
   (descending). Rows inserted after a page is fetched do not shift later pages;
   they appear on a later walk from the start. Two rows that share `created_at`
   are ordered by `id`, so a newly inserted sibling cannot skip or duplicate
   items already returned.

### Pagination object

```json
{
  "next_cursor": "v2c.…",
  "has_more": true,
  "limit": 20
}
```

`total` is intentionally omitted. Counting every row is expensive and races
with inserts; clients that need a count use a dedicated summary endpoint.

---

## Handler contract (router registry)

v2 handlers return **domain values**, never HTTP envelopes:

```ts
// item
return subscription;

// list
return paginate(items, { limit, cursor, nextCursor, hasMore });

// empty delete
return null;
```

The registry:

1. Reads `x-request-id`.
2. Validates cursor/limit for list routes.
3. Wraps the return value in the success envelope.
4. Maps thrown `AppError` / `ZodError` / `CursorError` to Problem Details.

---

## v1 deprecation timeline

| Surface | Status | Deprecated | Sunset (removal eligible) |
|---------|--------|------------|---------------------------|
| Unversioned `/api/*` (legacy v1) | Frozen | 2026-08-26 | **2027-02-26** |
| `/api/v1/*` | Frozen alias of legacy handlers | 2026-08-26 | **2027-02-26** |
| `/api/v2/*` | Current | — | — |

Until 2027-02-26, v1 payloads stay **byte-compatible** with today's clients
(no envelope migration). After the sunset date v1 may return `410` or be
removed in the next major backend release, following
[docs/deprecation-policy.md](../deprecation-policy.md) (breaking change:
minimum two release cycles; v2 ships with a six-month overlap).

Migration: parse the v2 success/error/pagination schemas above. Do not read
`success: true` or offset `page` fields on v2.

Next.js App Router handlers under `client/app/api/v2/` use the same envelope
(`client/lib/api/v2-envelope.ts`).
