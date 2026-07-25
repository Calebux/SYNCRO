# Coverage Thresholds

Coverage thresholds are enforced per package. A CI run fails if any threshold is not met.

## Thresholds

| Package | Branches | Functions | Lines | Statements | Config |
|---------|----------|-----------|-------|------------|--------|
| `client` | 75 % | 85 % | 80 % | 80 % | `client/vitest.config.ts` → `coverage.thresholds` |
| `backend` | 80 % | 80 % | 80 % | 80 % | `backend/jest.config.js` → `coverageThreshold` |
| `sdk` | 70 % | 75 % | 75 % | 75 % | `sdk/jest.config.js` → `coverageThreshold` |
| `shared` | 70 % | 75 % | 75 % | 75 % | `shared/jest.config.js` → `coverageThreshold` |
| `contracts` | n/a | n/a | n/a | n/a | Rust — `cargo test` run in `contracts.yml`; no JS coverage tool |

## CI enforcement

- `test-client` job: `vitest run --coverage` — vitest exits non-zero if thresholds are not met.
- `test-backend` job: `jest --coverage --ci` — Jest exits non-zero if thresholds are not met.
- `test-sdk` job: `jest --coverage --ci` — enforced by `sdk/jest.config.js`.
- `test-shared` job: `jest --coverage --ci` — enforced by `shared/jest.config.js`.

## Exemptions

Files excluded from coverage measurement are listed in the `coverage.exclude` array of each config:

- Generated types (`*.d.ts`, `types.ts`)
- Config files (`*.config.ts`, `*.config.js`)
- Storybook stories
- E2E specs
- `public/` assets

To exclude a specific file, add its glob to the relevant `exclude` list and document the reason in a comment.

## Raising thresholds

When aggregate coverage improves, raise the threshold in the relevant config file in the same PR that adds the tests. Do not lower thresholds without a documented reason in the PR description.
