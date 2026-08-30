# Dependency Management Policy

## Overview

This document outlines the dependency management policy for the SYNCRO project to ensure reproducible builds, minimize CI drift, and maintain stability across environments.

## Policy Rules

### 1. No `latest` Versions

**Rule**: Never use `latest` as a version specifier in `package.json`.

**Rationale**: 
- `latest` is non-deterministic and can cause different versions to be installed at different times
- Breaks reproducibility across environments
- Can introduce breaking changes unexpectedly
- Makes debugging difficult when issues arise

**Enforcement**: Pre-commit hooks and CI checks will reject any `package.json` with `latest` versions.

### 2. Version Pinning Strategy

We use a tiered approach to version pinning based on package stability and criticality:

#### Tier 1: Exact Versions (No Range)
Use exact versions for:
- **Critical infrastructure**: Build tools, compilers, bundlers
- **Known unstable packages**: Packages with frequent breaking changes
- **Radix UI components**: To ensure UI consistency

**Format**: `"package": "1.2.3"` (no prefix)

**Examples**:
```json
{
  "next": "15.2.4",
  "@radix-ui/react-dialog": "1.1.4",
  "cmdk": "1.0.4"
}
```

#### Tier 2: Caret Ranges (Minor/Patch Updates)
Use caret ranges for:
- **Stable, well-maintained packages**: React, utility libraries
- **Packages following semver strictly**: Most npm packages
- **Development tools**: Linters, formatters, test runners

**Format**: `"package": "^1.2.3"` (allows 1.x.x, but not 2.0.0)

**Examples**:
```json
{
  "react": "^19",
  "zod": "^3.25.76",
  "@types/node": "^22.19.15"
}
```

#### Tier 3: Tilde Ranges (Patch Updates Only)
Use tilde ranges for:
- **Packages with breaking changes in minors**: Some older packages
- **When you need patch updates but not minor updates**

**Format**: `"package": "~1.2.3"` (allows 1.2.x, but not 1.3.0)

**Rarely used** - prefer exact or caret.

### 3. Lockfile Management

#### Always Commit Lockfiles
- `package-lock.json` must always be committed
- Lockfiles ensure exact versions are installed across all environments
- Never add lockfiles to `.gitignore`

#### Lockfile Updates
- Update lockfiles when dependencies change
- Run `npm install` after pulling changes
- Regenerate lockfile if corrupted: `rm package-lock.json && npm install`

#### Lockfile Conflicts
When resolving merge conflicts in lockfiles:
```bash
# Option 1: Accept one side and regenerate
git checkout --theirs package-lock.json
npm install

# Option 2: Delete and regenerate
rm package-lock.json
npm install
```

### 4. Dependency Update Process

#### Regular Updates (Monthly)
1. **Review outdated packages**:
   ```bash
   npm outdated
   ```

2. **Update non-breaking changes**:
   ```bash
   # Update patch versions only
   npm update
   
   # Or update specific package
   npm update package-name
   ```

3. **Test thoroughly**:
   ```bash
   npm run build
   npm run lint
   npm run e2e
   ```

4. **Commit with clear message**:
   ```bash
   git add package.json package-lock.json
   git commit -m "chore(deps): update dependencies (patch versions)"
   ```

#### Major Updates (Quarterly or As Needed)
1. **Check for major updates**:
   ```bash
   npm outdated
   ```

2. **Update one package at a time**:
   ```bash
   npm install package-name@latest
   ```

3. **Review changelog**:
   - Check package's GitHub releases
   - Look for breaking changes
   - Review migration guides

4. **Test extensively**:
   ```bash
   npm run build
   npm run lint
   npm run e2e
   # Manual testing of affected features
   ```

5. **Update code if needed**:
   - Fix breaking changes
   - Update types
   - Update usage patterns

6. **Commit with detailed message**:
   ```bash
   git commit -m "chore(deps): upgrade package-name to v2.0.0
   
   BREAKING CHANGES:
   - Updated API usage in components/...
   - Fixed type errors in lib/...
   
   See: https://github.com/org/package/releases/tag/v2.0.0"
   ```

#### Security Updates (Immediate)
1. **Check for vulnerabilities**:
   ```bash
   npm audit
   ```

2. **Fix automatically if possible**:
   ```bash
   npm audit fix
   ```

3. **Manual fix if needed**:
   ```bash
   npm audit fix --force
   # Or update specific package
   npm install package-name@version
   ```

4. **Test and deploy quickly**:
   ```bash
   npm run build
   npm run e2e
   # Deploy to production
   ```

### 5. Adding New Dependencies

#### Before Adding
1. **Evaluate necessity**: Can you implement it yourself? Is it worth the dependency?
2. **Check package health**:
   - Weekly downloads (prefer >100k)
   - Last updated (prefer <6 months)
   - Open issues vs closed issues
   - Maintenance status
   - License compatibility

3. **Check bundle size**:
   ```bash
   npx bundle-phobia package-name
   ```

#### When Adding
1. **Install with exact version**:
   ```bash
   # For critical packages
   npm install --save-exact package-name
   
   # For stable packages
   npm install package-name
   ```

2. **Document why**:
   ```bash
   git commit -m "feat: add package-name for feature X
   
   Adds package-name (v1.2.3) to implement feature X.
   Evaluated alternatives: Y, Z
   Chosen because: reason
   Bundle size: +50KB
   License: MIT"
   ```

### 6. Removing Dependencies

#### When to Remove
- Package is no longer used
- Package is unmaintained
- Better alternative exists
- Functionality can be implemented in-house

#### How to Remove
1. **Remove from code first**:
   - Delete all imports
   - Remove all usage
   - Test thoroughly

2. **Uninstall**:
   ```bash
   npm uninstall package-name
   ```

3. **Verify removal**:
   ```bash
   npm run build
   npm run lint
   ```

4. **Commit**:
   ```bash
   git commit -m "chore(deps): remove package-name
   
   No longer needed after refactoring feature X.
   Reduces bundle size by 50KB."
   ```

## Automation

### Pre-commit Hooks

Located in `.husky/pre-commit`:
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Check for 'latest' in package.json
if grep -q '"latest"' package.json; then
  echo "❌ Error: 'latest' version found in package.json"
  echo "Please specify an exact version or semver range."
  exit 1
fi

# Run linter
npm run lint
```

### CI Checks

Located in `.github/workflows/ci.yml`:
```yaml
- name: Check for latest versions
  run: |
    if grep -q '"latest"' package.json; then
      echo "Error: 'latest' version found in package.json"
      exit 1
    fi

- name: Verify lockfile is up to date
  run: |
    npm ci
    git diff --exit-code package-lock.json
```

### NPM Scripts

Add to `package.json`:
```json
{
  "scripts": {
    "deps:check": "npm outdated",
    "deps:audit": "npm audit",
    "deps:update": "npm update && npm run build && npm run lint",
    "deps:validate": "node scripts/validate-deps.js"
  }
}
```

## Troubleshooting

### Different Versions Installed Than Specified

**Problem**: `npm install` installs different versions than in `package.json`

**Solution**:
```bash
# Delete node_modules and lockfile
rm -rf node_modules package-lock.json

# Reinstall
npm install

# Verify versions
npm list --depth=0
```

### Lockfile Conflicts

**Problem**: Merge conflicts in `package-lock.json`

**Solution**:
```bash
# Accept one side
git checkout --ours package-lock.json  # or --theirs

# Regenerate
npm install

# Verify build works
npm run build
```

### CI Fails with Different Versions

**Problem**: CI installs different versions than local

**Solution**:
1. Ensure lockfile is committed
2. Use `npm ci` in CI (not `npm install`)
3. Verify Node.js version matches (use `.nvmrc`)
4. Clear CI cache if needed

### Peer Dependency Warnings

**Problem**: Warnings about peer dependencies

**Solution**:
```bash
# Check what's needed
npm info package-name peerDependencies

# Install missing peer dependencies
npm install peer-dep-name@version

# Or use --legacy-peer-deps flag (not recommended)
npm install --legacy-peer-deps
```

## Best Practices

### ✅ Do
- Use exact versions for critical packages
- Use caret ranges for stable packages
- Commit lockfiles
- Update dependencies regularly
- Test after updates
- Document breaking changes
- Use `npm ci` in CI/CD
- Review changelogs before updating

### ❌ Don't
- Use `latest` as a version
- Use `*` as a version
- Ignore lockfile conflicts
- Update all dependencies at once
- Skip testing after updates
- Commit without testing
- Use `npm install` in CI
- Update without reading changelogs

## Tools

### Useful Commands
```bash
# Check outdated packages
npm outdated

# Check for security vulnerabilities
npm audit

# Update patch versions only
npm update

# Install exact version
npm install --save-exact package@version

# Check package info
npm info package-name

# Check bundle size
npx bundle-phobia package-name

# List installed versions
npm list --depth=0

# Verify lockfile integrity
npm ci
```

### Useful Tools
- [npm-check-updates](https://www.npmjs.com/package/npm-check-updates) - Interactive dependency updates
- [bundle-phobia](https://bundlephobia.com/) - Check bundle size impact
- [Snyk](https://snyk.io/) - Security vulnerability scanning
- [Dependabot](https://github.com/dependabot) - Automated dependency updates
- [Renovate](https://www.mend.io/renovate/) - Advanced dependency management

## References

- [npm semver documentation](https://docs.npmjs.com/cli/v6/using-npm/semver)
- [package.json documentation](https://docs.npmjs.com/cli/v8/configuring-npm/package-json)
- [npm-ci documentation](https://docs.npmjs.com/cli/v8/commands/npm-ci)
- [Semantic Versioning](https://semver.org/)

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-04-27 | Initial policy created | AI Assistant |

---

**Questions?** Contact the engineering team or open an issue.
