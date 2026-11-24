# Test Coverage

Issue: [#1090](https://github.com/Calebux/SYNCRO/issues/1090)

Coverage is collected per package, gated against a per-package minimum, and
reported on every PR with a delta against the target branch.

## Where the numbers come from

| Package | Runner | Command |
| --- | --- | --- |
| `backend` | Jest | `npm test -- --coverage` |
| `client` | Vitest (v8) | `npm run test:coverage` |
| `sdk` | Jest (ESM) | `npm test -- --coverage` |
| `contracts` | `cargo llvm-cov` | `cargo llvm-cov --workspace --summary-only` |

Each writes an Istanbul `coverage-summary.json` (Rust writes a single
percentage). `.github/workflows/coverage.yml` runs all four in parallel,
aggregates them with `scripts/coverage-report.js`, posts the PR comment and
enforces the gate.

## The gate

`coverage-thresholds.json` is the single source of truth for minimums. The
aggregate check is what blocks a merge:

```bash
node scripts/coverage-report.js --check
```

Each package's own test config mirrors its numbers, so `npm test -- --coverage`
fails locally for the same reason CI does.

Per-package jobs use `continue-on-error: true` deliberately: one package
dropping below its floor should not hide the other three packages' numbers from
the report. The aggregate `--check` step at the end is the blocking gate.

## Minimums are ratchets

Set the minimum at the **measured floor**, not at an aspiration. A gate set to a
number the codebase does not meet fails on every run, and a gate that always
fails is a gate everyone learns to ignore — which is exactly what happened here:
`backend/jest.config.js` declared 80% across the board while actual coverage was
57%, so `test-backend` had been red in CI for some time.

The rule:

- **Raise** a minimum when coverage has risen and held. Do it in its own PR.
- **Never lower** a minimum to make a red build pass. Add the tests instead.
- If a minimum genuinely needs lowering (a large well-tested module was
  removed), say so explicitly in the PR description.

### Current state

| Package | Lines | Statements | Functions | Branches |
| --- | --- | --- | --- | --- |
| `backend` | 55 | 55 | 55 | 44 |
| `client` | *pending* | *pending* | *pending* | *pending* |
| `sdk` | *pending* | *pending* | *pending* | *pending* |
| `contracts` | *pending* | — | — | — |

The backend floor comes from a measured run (58.00 / 57.48 / 57.14 / 46.48 on
2026-07-25), rounded down.

**Pending** packages have never had coverage measured in CI, so their minimums
are 0 — a guessed number would either be meaningless or break the build. The
first run of the coverage workflow reports their real figures in the PR comment;
raise each minimum to just under its reported value in a follow-up PR. Note that
`client/vitest.config.ts` previously declared 80/80/85/75, but CI ran client
tests without `--coverage`, so those numbers were never verified.

## The PR comment

A single sticky comment, updated in place rather than appended per push:

```
## 📊 Coverage Report

| Package    | Lines  | Statements | Functions | Branches | Δ Lines  | Min (lines) | Status  |
| ---------- | ------ | ---------- | --------- | -------- | -------- | ----------- | ------- |
| `backend`  | 58.00% | 57.48%     | 57.14%    | 46.48%   | ▲ +2.50% | 55.00%      | ✅ pass |
| `client`   | —      | —          | —         | —        | —        | 0.00%       | ⚪ not run |
```

The delta compares against the target branch's last recorded numbers, cached by
the workflow's `push` run on that branch. On the first run there is no cache, so
the delta column is omitted — this is expected, not a failure.

## Running locally

```bash
# One package
cd backend && npm test -- --coverage

# Aggregate whatever has been run
node scripts/coverage-report.js

# With a delta against a saved baseline
node scripts/coverage-report.js --baseline coverage-baseline.json

# Fail if any package is under its minimum
node scripts/coverage-report.js --check
```

`--json out.json` emits machine-readable totals, which is how the workflow
records a branch's baseline for the next PR's delta.
