# Structured Audit Logging — Client API

## Overview

Sensitive client API mutations emit structured audit events via `emitAuditEvent()` from `client/lib/api/audit.ts`. Events are written as JSON to stdout and captured by the log aggregation pipeline.

## Schema

```jsonc
{
  "audit": true,               // always true — used as a log filter key
  "timestamp": "ISO-8601",     // set automatically
  "userId": "uuid",            // opaque user UUID — never email, name, or IP
  "action": "payment.create",  // see Actions table below
  "resourceType": "payment",
  "resourceId": "optional-uuid-or-id",
  "metadata": {                // optional; non-PII key/value pairs only
    "provider": "stripe",
    "imported": 5
  }
}
```

## Actions

| Action | Route | Trigger |
|--------|-------|---------|
| `payment.create` | `POST /api/payments` | Successful charge |
| `payment.refund` | `POST /api/payments/refund` | Successful refund |
| `subscription.import` | `POST /api/subscriptions/import?commit=true` | Rows committed |
| `subscription.delete` | `DELETE /api/subscriptions/[id]` | Row deleted |
| `subscription.pause` | `POST /api/subscriptions/[id]/pause` | Status set to paused |
| `subscription.resume` | `POST /api/subscriptions/[id]/resume` | Status set to active |
| `subscription.bulk_delete` | bulk action hook | Reserved |
| `mfa.enroll` | MFA routes | Reserved |
| `mfa.verify` | MFA routes | Reserved |
| `mfa.disable` | MFA routes | Reserved |
| `privacy.settings_update` | Settings routes | Reserved |
| `account.delete_request` | Account routes | Reserved |

## PII policy

- `userId` is always an opaque UUID.
- Email addresses, IP addresses, user agents, and subscription names **must not** appear in audit log fields.
- `metadata` values must be counts, enum strings, provider names, or boolean flags — never raw user input.

## Implementation

```ts
import { emitAuditEvent } from "@/lib/api/audit"

emitAuditEvent({
  userId: user.id,
  action: "payment.create",
  resourceType: "payment",
  resourceId: result.transactionId,
  metadata: { provider: body.provider },
})
```

`emitAuditEvent` is fire-and-forget — errors are swallowed so the caller is never affected.
