# Dependency Update Policy

## Overview
This document outlines the policy for managing dependencies across the SYNCRO project to ensure reproducible builds and intentional dependency upgrades.

## Background
Previously, several dependencies used the "latest" version specifier, which can break CI/CD pipelines unexpectedly when new versions are published. This has been replaced with explicit semver ranges.

## Current Practice

### Dependencies with Explicit Semver Ranges
All npm dependencies now use explicit semver ranges (caret `^` or exact pinned versions):

#### Client Dependencies (Updated)
- `@supabase/ssr`: `^0.10.2` (previously `latest`)
- `@supabase/supabase-js`: `^2.105.1` (previously `latest`)
- `date-fns`: `^4.1.0` (previously `latest`)
- `next-themes`: `^0.4.6` (previously `latest`)
- `react-qr-code`: `^2.0.18` (previously `latest`)
- `stripe`: `^22.1.0` (previously `latest`)

## Update Strategy

### Patch & Minor Updates (Automatic/Safe)
**Frequency:** Weekly or as needed
**Process:**
1. Run `npm audit fix` to apply security patches automatically
2. Review output for any breaking changes
3. Run tests to verify functionality
4. Commit changes with a clear message: `chore: update dependencies for security/bug fixes`

### Minor Version Updates (Semi-Automated)
**Frequency:** Monthly or as features are needed
**Process:**
1. Create a feature branch
2. Run `npm update` to update within the specified ranges
3. Update `package-lock.json`
4. Run full test suite (unit, integration, e2e)
5. Create a PR with changelog describing what updated and why
6. Request review from team
7. Merge only after approval and tests pass

### Major Version Updates (Manual/Required)
**Frequency:** As needed for breaking changes or significant features
**Process:**
1. Create an issue documenting the need for the major update
2. Create a feature branch for the upgrade
3. Manually update `package.json` with the new major version
4. Run `npm install --legacy-peer-deps` if needed to resolve conflicts
5. Address any breaking changes in code
6. Run full test suite including manual testing
7. Create a detailed PR including:
   - Migration guide
   - Breaking changes documented
   - Performance or feature improvements
   - Test results
8. Requires approval from tech lead before merging

## CI/CD Behavior

### Local Development
- Use `npm install` or `npm ci` to install exact versions from lock file
- Developers should not manually modify `package.json` version ranges

### CI Pipeline
- Uses `npm ci --legacy-peer-deps` to install exact pinned versions
- Prevents unexpected version changes from breaking the build
- Lock file is the source of truth for reproducibility

## Peer Dependency Notes

### React 19 Compatibility
The project uses React 19, but some dependencies (`@tremor/react`) still require React 18. To handle this:
- Continue using `--legacy-peer-deps` in CI and local installations
- Plan migration of conflicting dependencies in Q3 2026
- Monitor upstream packages for React 19 support

## Approval & Governance

- **Patch updates:** Developer can merge after CI passes
- **Minor updates:** Requires review (any team member)
- **Major updates:** Requires tech lead approval + QA sign-off
- **Security updates:** Can be expedited with 1 approval

## Monitoring

- Review dependencies monthly for security alerts
- Set up Dependabot or similar to notify of new versions
- Review npm audit output weekly
- Document reasons for staying on older major versions

## Related Tasks

- Regenerated client `package-lock.json` with `npm install --legacy-peer-deps`
- All builds and tests should now be reproducible across local and CI environments
- Dependencies are now reviewable and intentional

---
**Last Updated:** April 28, 2026
**Status:** Active
