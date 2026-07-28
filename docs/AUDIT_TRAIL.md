# API Key Audit Trail

## Overview

All API key lifecycle events are recorded in the `audit_logs` table via `auditApiKeyEvent` in `backend/src/services/audit-service.ts`.

## Logged Events

| Event | Trigger | Actor |
|---|---|---|
| `api_key.created` | `POST /api/keys` | Authenticated user |
| `api_key.revoked` | `DELETE /api/keys/:id` | Authenticated user |
| `api_key.auth_failed` | Invalid/revoked key presented to any route | `null` (unauthenticated) |

> `api_key.rotated` is logged when a rotate endpoint is added (future work).

## Log Schema

Each entry in `audit_logs` includes:

| Column | Description |
|---|---|
| `user_id` | Actor (the user who performed the action; `null` for failed auth) |
| `action` | One of the event types above |
| `resource_type` | Always `api_key` |
| `resource_id` | Key ID (when known) |
| `metadata.keyName` | Human-readable key name |
| `metadata.scopes` | Scopes granted to the key |
| `metadata.correlationId` | Request correlation ID (see `CORRELATION_IDS.md`) |
| `metadata.reason` | Failure reason (failed auth only) |
| `ip_address` | Client IP |
| `user_agent` | Client user-agent |
| `created_at` | Timestamp |

## Tamper Evidence

Entries are append-only and hash-chained: each row carries `sequence`,
`entry_hash` and `prev_hash`, a database trigger rejects `UPDATE`/`DELETE`, and
`GET /api/audit/verify` re-walks the chain to detect edits, deletions and
reordering. See [`security/audit-log-tamper-evidence.md`](security/audit-log-tamper-evidence.md).

## Retention & Visibility

- **Retention**: Logs are kept indefinitely by default. Purging requires temporarily disabling the append-only trigger — see the retention section of the tamper-evidence doc.
- **User visibility**: Users can query their own logs via `GET /api/audit` (filtered by `resource_type=api_key`).
- **Admin visibility**: Admins can query all logs via the admin audit endpoint with no user filter.
- **RLS**: The `audit_logs` table enforces row-level security — users only see rows where `user_id = auth.uid()`. Admins bypass via service role.
- **Immutability**: No `UPDATE` or `DELETE` is permitted by application code. Only the Supabase service role (admin) can delete rows.
