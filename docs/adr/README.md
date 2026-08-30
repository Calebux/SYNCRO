# Architecture Decision Records (ADR)

This directory contains the canonical Architecture Decision Records (ADRs) for SYNCRO.

An ADR is a short text document that captures an architectural decision, including its context, trade-offs, and consequences. ADRs serve as the authoritative record of major technical decisions, preventing knowledge decay and eliminating the need to reverse-engineer architectural rationale.

---

## Mandatory ADR Policy

An ADR is **mandatory** for any pull request or proposal that introduces changes in any of the following areas:

1. **System Boundary Changes**: Modifying interactions between client, backend serverless functions, Express API service, Supabase DB, or blockchain smart contracts.
2. **Data Model & Ledger Changes**: Modifying table schemas, financial transaction ledger rules, state machines, or cryptographic key representations.
3. **Trust & Security Boundary Changes**: Altering authentication mechanisms, encryption key derivation, non-custodial balance guarantees, RLS policies, or privilege escalation boundaries.

If your PR touches any of these areas, you must include a new or updated ADR under `docs/adr/` and reference it in the PR description.

---

## ADR Lifecycle & Statuses

Each ADR tracks its lifecycle using one of the following statuses:

| Status | Definition |
|---|---|
| **Proposed** | Under active RFC review in a pull request or design issue. |
| **Accepted** | Approved and implemented in the codebase. |
| **Accepted (Retrospective)** | Formally documented after initial implementation to capture historical architectural reasoning. |
| **Superseded by [ADR-XXX](./ADR-XXX-title.md)** | Replaced by a newer architectural decision. Must include a link to the replacing ADR. |
| **Rejected** | Evaluated during RFC phase but decided against. Kept for historical reference. |

### How to Supersede an ADR

When a new decision replaces an existing ADR:
1. Create the new ADR (e.g. `ADR-005`) with status `Accepted` (or `Proposed`).
2. Add a `Supersedes: [ADR-011](./ADR-011-direct-token-transfer-renewals.md)` metadata field to the new ADR.
3. Update the old ADR's status to `Superseded by [ADR-005](./ADR-005-payment-channels-for-renewals.md)` and add a note explaining why it was replaced.
4. Update the index below to reflect the status change.

---

## Index of Architecture Decision Records

| ADR # | Title | Status | Date |
|---|---|---|---|
| [ADR-001](./ADR-001-frontend-backend-split.md) | Frontend/Backend API Split | Accepted (Retrospective) | 2026-05-27 |
| [ADR-002](./ADR-002-soroban-over-evm.md) | Adoption of Soroban (Stellar Smart Contracts) over EVM | Accepted (Retrospective) | 2026-05-28 |
| [ADR-003](./ADR-003-supabase-over-self-managed-db.md) | Supabase (Managed Postgres, Auth, RLS) over Self-Managed DB | Accepted (Retrospective) | 2026-05-29 |
| [ADR-004](./ADR-004-gift-cards-for-phase-1.md) | Prepaid Crypto Gift Cards for Phase 1 Onboarding & Payments | Accepted (Retrospective) | 2026-05-30 |
| [ADR-005](./ADR-005-payment-channels-for-renewals.md) | Payment Channels & Execution Windows for Subscription Renewals | Accepted (Retrospective) | 2026-06-01 |
| [ADR-006](./ADR-006-funds-in-escrow.md) | Arbiter-Mediated Escrow Contracts for High-Value Subscriptions | Accepted (Retrospective) | 2026-06-03 |
| [ADR-007](./ADR-007-double-entry-gift-card-ledger.md) | Double-Entry Immutable Ledger for Gift Card Financial Tracking | Accepted (Retrospective) | 2026-06-05 |
| [ADR-008](./ADR-008-wallet-hkdf-encryption.md) | Self-Custodial Encryption Key Derivation (HKDF-SHA256) | Accepted (Retrospective) | 2026-06-10 |
| [ADR-009](./ADR-009-row-level-security-authorization.md) | Row-Level Security (RLS) as Primary Database Authorization Boundary | Accepted (Retrospective) | 2026-06-12 |
| [ADR-010](./ADR-010-quota-guard-rate-limiting.md) | Dual-Engine Rate Limiting (Redis Token Bucket + Memory Fallback) | Accepted (Retrospective) | 2026-06-15 |
| [ADR-011](./ADR-011-direct-token-transfer-renewals.md) | Direct Token Transfer for Recurring Subscription Renewals | Superseded by [ADR-005](./ADR-005-payment-channels-for-renewals.md) | 2026-05-25 |

---

## Creating a New ADR

1. Copy [`template.md`](./template.md) to `docs/adr/ADR-XXX-short-title.md` (use next available zero-padded 3-digit number).
2. Fill out all sections clearly, including context, alternatives considered, decision, and consequences.
3. Open a Pull Request referencing the design issue.
4. Update the index table above in `docs/adr/README.md`.
