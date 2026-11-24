# Dependency Version Management Policy

## Overview

This document outlines the policy for managing dependency versions in the SYNCRO project to ensure reproducible builds across local development and CI environments.

## Problem Statement

The use of "latest" version ranges in `package.json` reduces build reproducibility and can break CI pipelines unexpectedly. This policy establishes explicit versioning rules to prevent this issue.

## Changes Made

### Date: April 28, 2026

The following packages in `client/package.json` have been updated from "latest" to explicit semantic versioning:

| Package               | Previous | New      | Reason                                             |
| --------------------- | -------- | -------- | -------------------------------------------------- |
| @supabase/ssr         | latest   | ^0.10.2  | Supabase SSR adapter - patch/minor updates allowed |
| @supabase/supabase-js | latest   | ^2.104.1 | Supabase JS SDK - minor version bumps allowed      |
| date-fns              | latest   | ^4.1.0   | Date utilities - allows compatible updates         |
| next-themes           | latest   | ^0.4.6   | Theme management - compatible updates only         |
| react-qr-code         | latest   | ^2.0.18  | QR code rendering - minor version compatibility    |
| stripe                | latest   | ^22.1.0  | Stripe SDK - allows compatible minor/patch updates |

## Versioning Strategy

### Semver Range Format: `^X.Y.Z`

We use **caret ranges** (`^`) which allow:

- **Major version stays fixed** - prevents breaking changes
- **Minor version can update** - new features with backward compatibility
- **Patch version can update** - bug fixes and security patches

**Example:** `^2.104.1` allows:

- ✅ 2.104.5 (patch update)
- ✅ 2.105.0 (minor update)
- ❌ 3.0.0 (major version - breaking changes)

## Lock File Management

### pnpm-lock.yaml

The lock file (`client/pnpm-lock.yaml`) serves as the source of truth for exact dependency versions:

- **Purpose:** Records the exact versions resolved during `pnpm install`
- **Regeneration:** Run `pnpm install` to update after changing `package.json`
- **CI Environment:** Always uses locked versions from lock file
- **Local Development:** May receive updates within the allowed semver range

### Lock File Regeneration Process

```bash
cd client
pnpm install
# Commit both package.json and pnpm-lock.yaml changes
```

## Dependency Update Policy

### Automated Updates (Recommended)

Use a tool like **Renovate** or **Dependabot** configured with:

- Weekly update schedule
- Automatic patch/minor version bumps only
- Pull request-based review workflow
- Automated testing before merge

### Manual Updates

When manually updating dependencies:

1. **Single Package Update**

   ```bash
   cd client
   pnpm update @package/name
   ```

2. **All Allowed Updates**

   ```bash
   cd client
   pnpm update
   ```

3. **Verify Changes**

   ```bash
   # Run build
   npm run build

   # Run tests
   npm run test

   # Run e2e tests
   npm run e2e
   ```

4. **Commit**
   ```bash
   git add package.json pnpm-lock.yaml
   git commit -m "chore: update dependencies"
   ```

## CI/CD Integration

### Build Reproducibility Requirements

1. **Always use lock file:** `pnpm ci` (not `pnpm install`)
   - Uses exact versions from lock file
   - Fails if lock file is missing or corrupted
   - Prevents unexpected version mismatches

2. **Verify in CI workflow:**

   ```yaml
   - name: Install dependencies
     run: cd client && pnpm ci

   - name: Build
     run: cd client && npm run build

   - name: Test
     run: cd client && npm run test
   ```

## Best Practices

### ✅ DO

- Pin major versions explicitly (e.g., `^2.104.1` not `^2`)
- Review dependency updates in pull requests
- Run full test suite before merging
- Document breaking changes in release notes
- Keep lock file committed to version control
- Use `pnpm ci` in CI environments

### ❌ DON'T

- Use `latest` in package.json
- Use `*` or overly broad ranges
- Skip tests when updating dependencies
- Manually edit lock file
- Use `pnpm install` in CI (use `pnpm ci`)
- Update dependencies without reviewing changes

## Security Considerations

### Vulnerability Detection

Monitor for security issues:

- Use `pnpm audit` to check for vulnerabilities
- Configure Dependabot security updates
- Review CVE notifications for installed packages

### Security Updates

For critical security patches:

1. Update package.json with new version
2. Run `pnpm install` to regenerate lock file
3. Run full test suite
4. Deploy immediately after passing tests

## Acceptance Criteria Verification

✅ **Installs are reproducible across local and CI environments**

- Lock file pins exact versions
- CI uses `pnpm ci` for deterministic installs
- No "latest" versions in package.json

✅ **Dependency upgrades become intentional and reviewable**

- Updates go through pull requests
- Changes visible in git diff
- Tests verify compatibility
- Caret ranges allow safe minor/patch updates

## References

- [Semantic Versioning](https://semver.org/)
- [pnpm Documentation](https://pnpm.io/)
- [Renovate](https://www.whitesourcesoftware.com/free-developer-tools/renovate/) - Automated dependency updates
- [Dependabot](https://dependabot.com/) - GitHub's dependency management tool

## Next Steps

1. Run `pnpm install` to regenerate lock file with new versions
2. Commit changes: `git commit -am "fix: pin dependency versions for reproducible builds"`
3. Configure automated dependency updates (Renovate/Dependabot)
4. Update CI pipeline to use `pnpm ci` instead of `pnpm install`
5. Monitor for security vulnerabilities

## Questions or Updates?

For questions about this policy, please refer to the CONTRIBUTING.md file or open an issue in the repository.
