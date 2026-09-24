# v3 Metered Rails Threat Model

Version: 0.1  
Last updated: 2026-09-24  
Scope: SYNCRO v3 gateway, meter, settlement, registry/cap/channel contracts

## System Boundaries

This model covers the v3 flow where an API call is metered off-chain and settled via
payment-channel state and contract submission. It explicitly distinguishes:

- **Contract-enforced controls**: checks that hold even if backend services misbehave.
- **Backend-enforced controls**: checks that depend on gateway/meter/settlement correctness.

## Actors and Capabilities

### 1) Malicious consumer

Attempts:
- Replay an older signed state that is cheaper for the consumer.
- Submit forged meter metadata to reduce billable units.
- Trigger close/dispute strategically to deny settlement.

Current controls:
- Contract nonce/sequence progression on channel state (**contract-enforced**).
- Signed state verification and request idempotency (**backend-enforced**).
- Watchtower challenge flow for newer state submission (**backend + contract**).

Residual risk accepted:
- During service degradation, temporary stale risk in visibility can delay operator response.
  This is accepted short-term while live channel/degraded status propagation is active.

### 2) Malicious provider

Attempts:
- Inflate meter units before settlement.
- Withhold receipt fields needed for independent verification.
- Front-run close timing to favor provider-side state.

Current controls:
- Receipt signatures and meter/accounting reconciliation (**backend-enforced**).
- Consumer unilateral close path and dispute challenge window (**contract-enforced**).

Residual risk accepted:
- Meter correctness still depends on backend telemetry integrity until independent meter
  attestations are deployed.

### 3) Compromised agent key

Attempts:
- Spend rapidly up to delegated cap.
- Shift route usage pattern to high-value endpoints.
- Resume a dormant key to avoid immediate notice.

Current controls:
- Cap limits the max exposure (**contract-enforced** where cap is on-chain).
- Risk scoring and anomaly detection hooks (**backend-enforced**).
- Single-action containment endpoint to revoke key and suspend in-flight exposure
  (**backend-enforced**).

Residual risk accepted:
- Loss up to configured cap remains possible prior to containment trigger.

### 4) Compromised settlement key

Attempts:
- Submit unauthorized settlement batches.
- Finalize stale or manipulated channel states.
- Redirect settlement destinations.

Current controls:
- Contract method constraints on state validity and signer expectations
  (**contract-enforced** where signer checks are explicit).
- Backend approval, key-rotation, and audit trails (**backend-enforced**).

Residual risk accepted:
- If operator access and settlement key are both compromised, backend gates can be bypassed
  before rotation; operational segregation mitigates but does not eliminate this.

### 5) Hostile network intermediary

Attempts:
- Delay/drop challenge or close-related traffic.
- Replay old payloads at edge/gateway boundaries.
- Induce stale views that appear current to operators.

Current controls:
- TLS, request signatures, idempotency keys, and replay checks (**backend-enforced**).
- Live freshness indicators and stale-age stamps in the console (**frontend + backend**).

Residual risk accepted:
- Partial outage can force polling fallback; freshness remains visible but latency increases.

### 6) Malicious insider with operator access

Attempts:
- Revoke/rotate keys maliciously.
- Suppress alerts or alter compromise handling.
- Abuse admin APIs for channel suspension.

Current controls:
- Admin-auth boundaries and audit logs (**backend-enforced**).
- Limited contract authority on cap/channel mechanics (**contract-enforced** for core spend rules).

Residual risk accepted:
- Insider with sufficient privileges can still trigger operational disruption; compensating
  controls are auditability and separation of duties.

## Attack Mapping: Contract vs Backend Responsibility

| Attack | Primary prevention |
|---|---|
| Replay old channel state | Contract sequence checks (contract) |
| Exceed delegated spend cap | Cap contract checks (contract) |
| Force stale operator view | Freshness stamping + live updates (backend/frontend) |
| Inflate metered units | Meter validation, reconciliation (backend) |
| Unauthorized key use | Key revocation and response runbook (backend/ops) |
| Settlement submission abuse | Contract validity checks + backend signer controls |

## Mitigation Tracker

Every mitigation called out above is either already implemented or tracked:

| Mitigation | Status | Tracking |
|---|---|---|
| Live channel/degraded updates + fallback visibility | Implemented | #1507 |
| Console accessibility for critical operator flows | Implemented | #1506 |
| Agent-key compromise detect/respond workflow | Implemented + runbook | #1509 |
| Full threat model and residual-risk register | Implemented | #1508 |
| Meter attestation independence hardening | Open | follow-up security backlog item (to be filed) |
| Dual-control for high-impact admin containment actions | Open | follow-up security backlog item (to be filed) |
