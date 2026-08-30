# Technical Debt Registry

This file is the single source of truth for tracked technical debt in SYNCRO.
Every `TODO` / `FIXME` in a **critical path** (auth, payments, integrations)
must reference a GitHub issue, and that issue should appear in the table below.

The CI job **Tech Debt Policy** (`.github/workflows/debt-policy.yml`) blocks any
pull request that adds an untracked `TODO`/`FIXME` to a critical path.

---

## TODO / FIXME format

```ts
// TODO(#491): migrate to the new payment SDK
// FIXME(#496): PayPal integration is stubbed, returns mock response
```

- `(#NNN)` is the GitHub issue number — **required** in critical paths.
- Keep the description short; the issue holds the detail.
- Bare `// TODO: ...` (no issue ref) is allowed outside critical paths but
  will show as a warning in the scan.

## Critical paths (blocking)

Untracked TODO/FIXME here fails CI:

- `backend/`
- `sdk/`
- `shared/`
- `quota_guard/`
- `client/app/api/` (API routes — auth, payments, webhooks, CSP report)
- `client/lib/`
- `app/api/`
- `contracts/` (Soroban smart contracts — subscription renewal, escrow, virtual card)

Adjust this list in `scripts/check-todos.mjs` (`CRITICAL_PATHS`) and here together.

---

## Registry

| Issue | Location | Severity | Owner | Description | Added |
|-------|----------|----------|-------|-------------|-------|
| #496 | `client/app/api/csp-report/route.ts` | high | _unassigned_ | Replace stubbed PayPal integration with real client | 2026-05-29 |
| #494 | `backend/...` | med | _unassigned_ | Price changes / consolidation suggestions fetched from DB | 2026-05-29 |

> The rows above are seeded from existing issue summaries (`ISSUE_496_*`,
> `ISSUE_494_*`). Verify the file paths and owners, then keep this table in sync
> as TODOs are added or resolved.

---

## Debt triage workflow

1. **Create** — Before adding a TODO/FIXME in a critical path, open a GitHub
   issue describing the debt. Reference its number in the code comment:
   `// TODO(#NNN): ...`.
2. **Label** — Tag the issue `tech-debt` plus a severity label
   (`severity:high` / `severity:med` / `severity:low`). Auth/payment/integration
   gaps default to `high`.
3. **Register** — Add a row to the table above (issue, location, severity,
   owner, one-line description, date).
4. **Triage** — In the weekly engineering sync, review open `tech-debt` issues.
   Assign owners and a target milestone for every `severity:high` item.
5. **Resolve** — When the work is done, remove the TODO from the code, close the
   issue, and delete its row here. CI keeps code and registry from drifting:
   a removed-but-still-referenced TODO can't pass, and a new untracked one can't
   either.

## Running the check locally

```bash
node scripts/check-todos.mjs            # fails on untracked critical TODOs
node scripts/check-todos.mjs --warn-only  # report everything, never fail
npm run lint:todos                      # same, via package script
```
