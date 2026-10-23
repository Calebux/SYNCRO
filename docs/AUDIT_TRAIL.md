# Audit Trail Coverage

## Overview

All value-moving actions are recorded in the `audit_logs` table via functions in `backend/src/services/audit-service.ts`.

## Logged Events

### API Key Lifecycle

| Event | Trigger | Actor |
|---|---|---|
| `api_key.created` | `POST /api/keys` | Authenticated user |
| `api_key.rotated` | `POST /api/keys/:id/rotate` | Authenticated user |
| `api_key.revoked` | `DELETE /api/keys/:id` | Authenticated user |
| `api_key.auth_failed` | Invalid/revoked key presented to any route | `null` (unauthenticated) |

### Agent Lifecycle

| Event | Trigger | Actor |
|---|---|---|
| `agent.registered` | Agent registration | Operator / System |
| `agent.scope_granted` | Scope grant to agent | Operator |
| `agent.scope_revoked` | Scope revoke from agent | Operator |
| `agent.cap_issued` | Cap issued to agent | Operator |
| `agent.cap_changed` | Cap value changed | Operator |

### Payment Channel Lifecycle

| Event | Trigger | Actor |
|---|---|---|
| `channel.opened` | `POST /api/payment-channels` | Authenticated user |
| `channel.close_initiated` | `POST /api/payment-channels/:id/close` (bilateral) | Authenticated user |
| `channel.disputed` | `POST /api/payment-channels/:id/close` (unilateral) | Authenticated user |
| `channel.finalized` | Channel closure finalized | System / Operator |

### Key Lifecycle (Beyond API Keys)

| Event | Trigger | Actor |
|---|---|---|
| `key.issued` | Key issued (e.g., wallet key, signing key) | Operator / System |
| `key.revoked` | Key revoked | Operator / System |

### Rate Card / Pricing

| Event | Trigger | Actor |
|---|---|---|
| `rate_card.changed` | Rate card modified | Operator |

### Provider Configuration

| Event | Trigger | Actor |
|---|---|---|
| `provider.payout_address_changed` | Provider payout address updated | Operator |

### Operator Overrides

| Event | Trigger | Actor |
|---|---|---|
| `operator.override` | Manual operator override | Operator (admin) |

### System Events

| Event | Trigger | Actor |
|---|---|---|
| `system.degraded_mode` | System enters degraded mode | System |
| `reconciliation.adjusted` | Reconciliation adjustment applied | System / Operator |

## Log Schema

Each entry in `audit_logs` includes:

| Column | Description |
|---|---|
| `user_id` | Actor (the user who performed the action; `null` for system events) |
| `action` | One of the event types above |
| `resource_type` | Resource type (e.g., `api_key`, `agent`, `payment_channel`, `key`, `rate_card`, `provider`, `system`, `reconciliation`) |
| `resource_id` | Resource ID (when known) |
| `metadata.correlationId` | Request correlation ID (see `CORRELATION_IDS.md`) |
| `metadata.before` | State before the action (when applicable) |
| `metadata.after` | State after the action (when applicable) |
| `metadata.sourceAddress` | Source blockchain address (when applicable) |
| `metadata.reason` | Reason for the action (for overrides, revocations, etc.) |
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
- **User visibility**: Users can query their own logs via `GET /api/audit` (filtered by `resource_type`).
- **Admin visibility**: Admins can query all logs via the admin audit endpoint with no user filter.
- **RLS**: The `audit_logs` table enforces row-level security — users only see rows where `user_id = auth.uid()`. Admins bypass via service role.
- **Immutability**: No `UPDATE` or `DELETE` is permitted by application code. The database trigger `audit_logs_append_only` rejects all UPDATE and DELETE operations for all roles including `service_role`.

## Testing

Run the audit trail tests:
```bash
npm test -- backend/tests/audit-hash-chain.test.ts
```

The test suite verifies:
1. Hash chain integrity
2. Tamper detection (edits, deletions, reordering, re-signing)
3. Application role cannot delete or mutate entries
4. Verification detects tampering even if database trigger is bypassed