# SYNCRO MVP Roadmap

**Backlog ID:** [#120](https://github.com/Calebux/SYNCRO/issues/120)  
**Last updated:** 2026-05-31  
**Source backlog:** [repo-issue-backlog-2026-05.md](./repo-issue-backlog-2026-05.md)

This document maps open work to MVP completion. Use it in sprint planning alongside [issue-triage-policy.md](./issue-triage-policy.md) and the [technical debt registry](../DEBT.md).

---

## MVP exit criteria

MVP is **done** when every criterion below is met. Each is verifiable in CI, ops dashboards, or a short manual checklist.

| # | Criterion | How to verify |
|---|-----------|---------------|
| E1 | **Security baseline** — no client-side service-role keys; unified Next.js config; CSP and auth middleware enforced on all API routes | CI `validate-dependencies` job; [backlog #35](./repo-issue-backlog-2026-05.md#35--p0-eliminate-accidental-service-role-usage-from-client-server-code), [#598](./repo-issue-backlog-2026-05.md#598--p0-unify-conflicting-nextjs-configuration-files) closed |
| E2 | **Core product flows** — register, login, MFA, subscription CRUD, reminders, and analytics work end-to-end against production Supabase | Smoke suite in [SMOKE_TESTS.md](./SMOKE_TESTS.md) green; manual checklist in [CurrentState.md](./archive/CurrentState.md#success-metrics) |
| E3 | **Payments** — Stripe and Paystack webhooks process live events; no stubbed payment paths in `client/app/api/` or `client/lib/` | Webhook integration tests pass; zero `severity:high` `tech-debt` issues in payments area |
| E4 | **Ops quality** — per-route bundle budgets enforced; no budget violations on `main` | CI [bundle-size workflow](../.github/workflows/bundle-size.yml); [backlog #697](./repo-issue-backlog-2026-05.md#697--p2-tighten-bundle-size-budgets-for-the-client-app) |
| E5 | **Technical debt gate** — every TODO/FIXME in critical paths references a tracked GitHub issue | `node scripts/check-todos.mjs` exits 0; [DEBT.md](../DEBT.md) registry matches code |
| E6 | **Blockchain (testnet)** — subscription registry, renewal, escrow, and virtual-card contracts deployed and exercised on Stellar testnet | Contract test suite green; deployment runbook signed off |
| E7 | **Production readiness** — Sentry alerting, correlation IDs, and rollback playbooks documented and exercised once | [SENTRY_ALERT_ROUTING.md](./SENTRY_ALERT_ROUTING.md), [MIGRATION_ROLLBACK_PLAYBOOKS.md](./MIGRATION_ROLLBACK_PLAYBOOKS.md) drill completed |

**Current MVP status:** ~90% — see [CurrentState.md](./archive/CurrentState.md). Primary gaps: live payment finalization (E3), mainnet contract audit (post-MVP), and remaining integration hardening (E7).

---

## Milestones & issue clusters

### M1 — Security & architecture foundation ✅

Foundation work that unblocks safe iteration. **Cluster complete.**

| Issue | Priority | Epic | Status |
|-------|----------|------|--------|
| [#35](https://github.com/Calebux/SYNCRO/issues/35) — Remove service-role from client | P0 | Client API security | ✅ Done — [backlog notes](./repo-issue-backlog-2026-05.md#35--p0-eliminate-accidental-service-role-usage-from-client-server-code) |
| [#598](https://github.com/Calebux/SYNCRO/issues/598) — Unify Next.js config | P0 | Architecture | ✅ Done — [backlog notes](./repo-issue-backlog-2026-05.md#598--p0-unify-conflicting-nextjs-configuration-files) |
| ADR-001 | — | Frontend/backend split | ✅ Accepted — [adr/ADR-001-frontend-backend-split.md](./adr/ADR-001-frontend-backend-split.md) |

### M2 — Production hardening 🔄

Hardening threads required before public MVP launch.

| Cluster | Representative issues | Area labels | Target |
|---------|----------------------|-------------|--------|
| **Payments & webhooks** | #496 (PayPal stub), Stripe/Paystack webhook hardening | `area:frontend`, `area:backend` | E3 |
| **Bundle & performance** | [#697](https://github.com/Calebux/SYNCRO/issues/697) bundle budgets, #698 Redis API latency storage | `area:frontend`, `area:backend` | E4 |
| **Integrations** | #494 (DB-backed suggestions), Telegram bot enrichment, email parsing | `area:backend`, `area:frontend` | E2 |
| **Tech debt governance** | [#120](https://github.com/Calebux/SYNCRO/issues/120) roadmap, DEBT.md policy | `area:governance` | E5 |

### M3 — MVP launch 🎯

Final gate before marking MVP complete.

| Cluster | Scope | Exit criteria |
|---------|-------|---------------|
| **Live payments** | Production webhook secrets, idempotency, DLQ handling | E3 — 7-day production webhook success rate ≥ 99% |
| **Smoke & E2E** | Full user journey in CI/staging | E2 — all smoke tests green on release branch |
| **Incident readiness** | On-call runbooks, CSP/payment drills | E7 — one documented drill per quarter |
| **Contracts (testnet)** | Soroban renewal + escrow flows | E6 — contract integration tests on testnet |

### M4 — Post-MVP (out of scope for exit)

Tracked but not blocking MVP: mainnet contract deployment, advanced email parsing ML, multi-region payment expansion.

---

## Completed issue clusters (historical)

Use these for context when grooming new work — patterns and resolutions are documented in the backlog archive.

| Cluster | Issues | Resolution doc |
|---------|--------|----------------|
| Client privilege escalation | #35 | [repo-issue-backlog-2026-05.md § #35](./repo-issue-backlog-2026-05.md#35--p0-eliminate-accidental-service-role-usage-from-client-server-code) |
| Next.js config drift | #598 | [repo-issue-backlog-2026-05.md § #598](./repo-issue-backlog-2026-05.md#598--p0-unify-conflicting-nextjs-configuration-files) |
| Bundle size enforcement | #697 | [repo-issue-backlog-2026-05.md § #697](./repo-issue-backlog-2026-05.md#697--p2-tighten-bundle-size-budgets-for-the-client-app) |
| Issue taxonomy & triage | #773 (merged) | [issue-triage-policy.md](./issue-triage-policy.md) |
| Tech debt CI policy | (this effort) | [DEBT.md](../DEBT.md), [INSTALL.md](../INSTALL.md) |

---

## How to use this roadmap

1. **Weekly grooming** — Pull the next open item from M2/M3 into sprint; confirm it maps to an exit criterion (E1–E7).
2. **New issues** — Tag with `area:`, `priority:`, and link the milestone (M2/M3) in the issue body. See [label-migration.md](./label-migration.md).
3. **Closing MVP** — When E1–E7 are all green, open a release issue, run smoke tests, and update [CurrentState.md](./archive/CurrentState.md).

**Related docs:** [DEBT.md](../DEBT.md) · [issue-triage-policy.md](./issue-triage-policy.md) · [branch-protection.md](./branch-protection.md)
