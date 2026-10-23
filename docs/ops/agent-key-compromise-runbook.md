# Agent Key Compromise Runbook (v3)

Issue: #1509  
Last updated: 2026-09-24

## Goal

Detect and contain a compromised agent API key quickly, using a **single response
operation** that:

1. Revokes the API key.
2. Suspends active channel spend exposure.
3. Cancels in-flight pending settlements tied to the affected principal.

## Detection Inputs

The compromise evaluator consumes these signals:

- Spend velocity anomaly (current/minute vs baseline/minute).
- New network origin.
- Route-mix shift percentage.
- Dormant key reuse days.

Risk levels:
- `low` (<40)
- `medium` (40-69)
- `high` (>=70)

## Automated Response Endpoint

Admin API:

- `POST /api/admin/agent-keys/:id/compromise/evaluate`
- `POST /api/admin/agent-keys/:id/compromise/respond`

The `respond` call performs containment in one action:

- Marks `api_keys.revoked = true`.
- Moves active `payment_channels` for the key owner to `closing`.
- Cancels `pending_settlements` in `pending|batched` states with an explicit reason.

## In-Flight and Unsettled Handling

When containment runs:

- **In-flight reservations** are treated as untrusted and are not allowed to progress.
- **Pending/batched settlements** are changed to `cancelled` with a compromise reason.
- Channels are pushed to close/challenge flow so counterparties can challenge if needed.

This behavior is deliberate to avoid silently settling potentially fraudulent usage.

## Staging Rehearsal Steps

1. Create a staging API key and baseline usage profile.
2. Simulate anomaly signals:
   - spike velocity >= 3x baseline
   - set new origin true
   - set route shift >= 35%
   - use dormant key >= 14 days
3. Call evaluate endpoint and verify `severity = high`.
4. Trigger respond endpoint for that key.
5. Verify:
   - key is revoked
   - active channels moved to `closing`
   - pending/batched settlements cancelled
6. Verify console shows state changes within seconds and stale-age never appears current.
7. Record drill evidence in incident tracker:
   - request/response payloads
   - affected object counts
   - operator timeline

## Rollback / Recovery

- Create replacement key via normal key issuance flow.
- Re-open or re-authorize channels only after root cause and host hygiene checks.
- Re-queue legitimate settlements manually after reconciliation.

## Ownership

- Primary: Security + Backend On-call
- Approver: Incident commander (or delegated security lead)
