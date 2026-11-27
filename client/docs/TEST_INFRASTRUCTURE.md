# Test Infrastructure Setup

This document describes the test infrastructure configuration for the client application.

## Overview

The test infrastructure includes:
- **Vitest** for unit and integration tests
- **Playwright** for E2E tests
- **V8 coverage provider** for code coverage reporting
- **Flaky test detection** for identifying unreliable tests
- **CI integration** with coverage enforcement

## Configuration Files

### Vitest Configuration (`vitest.config.ts`)

The Vitest configuration includes:
- **Coverage thresholds**: 70% lines, 65% branches, 75% functions, 70% statements
- **Coverage reporters**: text, HTML, JSON summary, LCOV
- **Test environment**: jsdom for DOM testing
- **Setup files**: `lib/test-utils/setup.ts` for global test setup

### Playwright Configuration (`playwright.config.ts`)

The Playwright configuration includes:
- **Retry logic**: 2 retries in CI, 0 locally
- **Reporters**: list, HTML, custom flaky reporter
- **Test fixtures**: Authentication and database state management
- **Multiple browsers**: Chromium, Firefox, WebKit, Mobile Chrome

### CI Workflow (`.github/workflows/test.yml`)

The CI workflow includes:
- **Unit tests** with coverage reporting
- **Coverage threshold checks** that fail the build if thresholds are not met
- **Codecov integration** for coverage tracking
- **PR comments** with coverage changes
- **E2E tests** across multiple browsers
- **Flaky test reporting** with artifact uploads
- **Accessibility tests** using Axe and Playwright

## Accessibility Testing

Accessibility testing is automated using `@axe-core/playwright`. Tests run against core routes to ensure compliance with WCAG 2.1 Level A and AA standards.

### Running Accessibility Tests

```bash
# Run accessibility checks
npm run test:a11y
```

### Known Violations

We track and reduce accessibility violations over time. Known issues that are currently being addressed are documented in `client/e2e/accessibility.spec.ts` under the `knownViolations` array. New regressions will fail the CI build.

## Running Tests

### Unit Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Run tests with coverage threshold check
pnpm test:coverage:check
```

### E2E Tests

```bash
# Run E2E tests
pnpm e2e

# Run E2E tests in headed mode (visible browser)
pnpm e2e:headed

# View E2E test report
pnpm e2e:report
```

## Coverage Thresholds

The following coverage thresholds are enforced in CI:

| Metric     | Threshold |
|------------|-----------|
| Lines      | 70%       |
| Branches   | 65%       |
| Functions  | 75%       |
| Statements | 70%       |

If any threshold is not met, the CI build will fail.

## Flaky Test Detection

The custom Playwright reporter tracks test failures and identifies flaky tests:

- **Critical**: Tests with >50% flake rate
- **Warning**: Tests with 30-50% flake rate
- **Stable**: Tests with 0% flake rate after 20 consecutive passes

Flaky test reports are saved to `test-results/flaky-tests.json` and uploaded as CI artifacts.

## Coverage Badge

To add a coverage badge to your README, configure Codecov and add:

```markdown
[![codecov](https://codecov.io/gh/YOUR_ORG/YOUR_REPO/branch/main/graph/badge.svg)](https://codecov.io/gh/YOUR_ORG/YOUR_REPO)
```

## Test Utilities

Test utilities are located in `lib/test-utils/`:

- `setup.ts`: Global test setup and mocks
- `flaky-reporter.ts`: Custom Playwright reporter for flaky test detection
- `fixtures.ts`: E2E test fixtures for authentication and database state

## Bundle Size Budget Enforcement

Bundle size budgets are defined in `client/bundle-size.json` and enforced in CI via the `Bundle Size Check` workflow (`.github/workflows/bundle-size.yml`).

### Budget Configuration

The `bundle-size.json` config defines:
- **total**: Maximum total JS size across all client chunks (KB)
- **shared**: Maximum size for shared/framework chunks (KB)
- **perRoute**: Per-route JS budgets (KB) — each route's total JS (page + shared) must stay under this
- **perChunk**: Maximum size for any individual JS chunk (KB)

### Checking Locally

```bash
# Build with analyzer
ANALYZE=true npm run build

# Run the check script
node scripts/check-bundle-size.js

# JSON output (for CI)
node scripts/check-bundle-size.js --json
```

### CI Behavior

- On every PR to `main`/`develop`, the workflow builds with `ANALYZE=true` and checks budgets
- If any budget is exceeded, the check fails and a comment is posted on the PR with details
- Warnings are posted when a route approaches 90% of its budget
- Exceptions require team review in the PR

### Updating Budgets

When intentionally adding size to the bundle (e.g., a new feature with necessary dependencies):

1. Run `node scripts/check-bundle-size.js --json` before and after
2. Update `bundle-size.json` with the new values in a separate commit
3. Mention the change in the PR description for reviewer awareness

## Next Steps

1. Install dependencies: `npm install`
2. Run tests: `npm test`
3. Configure Codecov token in GitHub secrets
4. Add coverage badge to README
