# Dependency Vulnerability Triage

> **Issue:** [#1079](https://github.com/Calebux/SYNCRO/issues/1079) — "Security: dependency vulnerability gate in CI (npm audit / Dependabot triage)"
>
> **Owners:** Mirabel64 (initial implementation). The on-call security engineer inherits the on-going triage duty (see `CODEOWNERS`).

## Why this exists

`pr-728` removed the lint/audit jobs from CI, leaving the repository with no
automated enforcement against published CVEs. This document and the
surrounding machinery restore that gate **and** give the team a documented
triage path for advisories that cannot be fixed immediately.

The acceptance criteria are:

1. CI fails on any **High** or **Critical** advisory that has not been triaged.
2. There is a documented triage process, including a versioned allowlist with
   a reason, rationale, ticket, and expiry date for every deliberate accept.

## How the gate works

`scripts/security-audit-gate.js` is invoked from `.github/workflows/ci.yml`
once per workspace (matrix: `backend`, `client`, `sdk`, `shared`). For every
workspace it:

1. Runs `npm audit --json --audit-level=none` (we want the data, not npm's
   exit-code behaviour).
2. Classifies each finding by its `GHSA-*` advisory id, walking the
   transitive via-chain so a single GHSA covers all the parent-less package
   rows npm-audit emits.
3. For **High** / **Critical** findings, checks the allowlist at
   `.github/dependency-audit-allowlist.json` for a matching GHSA whose
   `expires_at` is in the future and (if the entry has a `workspace` field)
   the current workspace is in that list. Most entries omit `workspace` and
   so apply globally.
   - **Triaged** → warn-only, exit `0`.
   - **Untriaged or expired** → print remediation steps and exit `1`.
4. For **Moderate** / **Low** findings (and expired allowlist entries) →
   surface as informational warnings, exit `0`.

The allowlist is the **only** mechanism for acknowledging an advisory
without fixing it. There is no equivalent of `--no-audit` — the gate is
structured so that the next person who hits a deliberate accept must also
renew or remove the entry before the date passes.

## Allowlist schema

`.github/dependency-audit-allowlist.json` has two top-level sections:

### `ignored_advisories`

Machine-consumed. Each key is a GitHub Security Advisory id (`GHSA-*`).
Keys are uppercased on load, so mixed-case input keys also match.
Each value is:

| Field               | Required | Notes                                                                 |
| ------------------- | -------- | --------------------------------------------------------------------- |
| `package`           | yes      | Human-readable package name.                                          |
| `transitive_callers`| no       | Optional array of packages that inherit this find transitively.      |
| `workspace`         | no       | Omit for GLOBAL acceptance (default). When present, it lists the workspaces that accept this GHSA; other workspaces still block. |
| `severity`          | yes      | One of `critical`, `high`, `moderate`, `low`. Echoes the advisory.   |
| `reason`            | yes      | One of the canonical reason codes below.                              |
| `rationale`         | yes      | One to three sentences explaining why the accept is safe today.       |
| `ticket`            | yes      | Issue/PR number (or `TBD-issue-followup-<pkg>` placeholder) that tracks the eventual fix or re-triage. |
| `expires_at`        | yes      | ISO date (`YYYY-MM-DD`). After this date the entry is **expired** and the gate fails. |

#### Important: a GHSA is advisory-level, not workspace-level

A GHSA applies to **any package-lock.json** that resolves the affected
package, regardless of which workspace it lives in. The default — every
existing entry in this file does this — is to omit `workspace`, which means
the allowlist entry covers all four workspaces. Only set `workspace` if
you are deliberately opt-in to a narrower scope (rare).

### `_informational_only`

Human-only. Surfaces Moderate/Low advisories so they get visibility at audit
time and can be added to the next monthly sprint. The gate does **not** read
this section; it exists so the allowlist file is the single source of
truth for both blocked and watched advisories.

### Reason codes (canonical)

These are the only values the gate recognises. Add a new one only if the
existing set cannot describe an accept — and update this doc at the same
time.

| Code                  | When to use                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `no-fix-yet`          | Upstream maintainer has not published a fix. The ticket tracks the upstream conversation.                          |
| `transitive-only`     | The vulnerable package is a transitive dep of a package we control. Fix requires coordinated transitive bump.      |
| `fix-scheduled`       | A patch is published; we have a planned upgrade. `expires_at` is the deliverable deadline.                       |
| `impact-assessed`     | A code-path review showed the vulnerable code path is unreachable in our deployment. Document the path in rationale. |
| `dev-only`            | The advisory only manifests in dev tooling that does not ship to production (build, lint, test).                  |
| `pinned-by-upstream`  | A framework we depend on pins the vulnerable version; we cannot move without the framework moving first.           |

## Operating procedure

### Daily

- **Dependabot opens a PR** with a patched advisory. CI runs the audit gate.
  If the bumped `package-lock.json` removes a triaged GHSA, the corresponding
  allowlist entry MUST be deleted in the same PR — otherwise the entry
  becomes stale and confusing.
- If the gate fails on an **unrelated** advisory (because someone else opened
  a PR), do not edit the allowlist to "fix" it. Instead, fix the advisory in
  package.json / lockfile, then re-run CI.

### When CI is green

If the gate exits 0 but you see `? N findings with no identifiable GHSA`
lines, those are advisories `npm audit` knows about but whose
`vulnerabilities[…].via` chain ended without surfacing a GHSA id. They are
non-blocking, but worth a manual look — sometimes they're missing from the
GitHub Advisory DB and won't be city-fixed; sometimes they're a sign the
allowlist is missing an upstream GHSA.

### Weekly (Mondays 06:00 UTC cron)

- The scheduled audit workflow re-runs and posts its summary to the artifacts.
  Review `audit-report-*` artifacts in failed runs.

### When CI is red because of a new advisory

1. **Try a fix first.** `cd <workspace> && npm audit fix`. Open that PR. No
   allowlist entry needed; the advisory disappears and CI goes green.
2. **If `npm audit fix` is unsafe or unavailable**, file a ticket explaining
   what is blocking the fix, then add or extend an `ignored_advisories` entry:
   - Pick a reason code that fits.
   - Set `expires_at` to a date **30 days or less in the future** so the
     entry cannot silently outlive the work needed to resolve it. Short
     windows (≤14 days) are encouraged; longer windows require a labelled
     rationale and a tighter follow-up issue.
   - Link back to this doc so the next reviewer can see the rule.
3. **PR description** for any allowlist change must include the rationale and
   ticket. The gate only enforces the schema; a thoughtful rationale is a
   human responsibility.

### Expired entries

The gate fails on expired entries even when no current npm-audit finding
matches them. That is intentional: an expired allowlist signal says "the
team promised to revisit this by date X and didn't." Treat expired entries
as an action item, not as paperwork.

When re-triaging:

- If the underlying issue is fixed upstream and npm-audit no longer reports
  it, **delete the entry** (don't bump the date).
- If the issue is still open and acceptable, **bump the date and the
  rationale**. A rationale that is the same six months later is a smell —
  say why the extension is reasonable in plain English.

### Moderate/Low warnings (informational only)

The gate surfaces moderate and low findings as informational lines and never
blocks on them. These come straight from `npm audit --json`, NOT from the
`_informational_only` section of the allowlist (that section is kept in the
file as a triager scratchpad, but the gate never reads it at runtime).

Example CI line:

```
ℹ  2 non-blocking findings (moderate/low):
    · moderate  @opentelemetry/core  GHSA-8988-4f7v-96qf
    · low       body-parser          GHSA-v422-hmwv-36x6
```

When a moderate/low advisory shows up persistently, copy it under
`_informational_only` so the next person scanning the file sees it, and
raise a ticket in the next monthly sprint board. The gate will not block
the current PR.

When re-triaging:

- If the underlying issue is fixed upstream and npm-audit no longer reports
  it, **delete the entry** (don't bump the date).
- If the issue is still open and acceptable, **bump the date and the
  rationale**. A rationale that is the same six months later is a smell —
  say why the extension is reasonable in plain English.

## What this document does **not** cover

- **Cargo advisories** for `contracts/`. Dependabot monitors them, but the
  npm-gate does not include `cargo audit`. Follow-up work tracked separately
  under `TBD-issue-followup-cargo-audit`.
- **Production-only vs. dev-only audits.** The gate audits everything visible
  to `npm audit`. Dev-only findings that need to be ignored go through
  `dev-only` reason codes — not through `--omit=dev`.
- **GitHub Actions advisories.** Covered by Dependabot's
  `github-actions` ecosystem, not by this gate.

## Related

- `docs/DEPENDENCY_MANAGEMENT.md` — overall dependency policy.
- `docs/DEPENDENCY_QUICK_REFERENCE.md` — common commands.
- `docs/security/secret-scanning.md` — sibling policy that this doc
  follows as a structural template (allowlist + rationale + expiry).
- `.github/dependabot.yml` — weekly Dependabot schedule.
- `backend/src/dependency-vulnerability-scanning/security.yml` — reference
  copy of the original `pr-728` audit workflow kept in tree for context.
