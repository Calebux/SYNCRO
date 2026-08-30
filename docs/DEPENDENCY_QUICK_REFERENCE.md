# Dependency Management Quick Reference

## 🚀 Quick Commands

### Validate Dependencies
```bash
cd client
npm run validate-deps
```

### Check Outdated
```bash
npm run deps:check
# or
npm outdated
```

### Security Audit
```bash
npm run deps:audit
# or
npm audit
```

### Update Patches
```bash
npm run deps:update
# or
npm update
```

## 📦 Adding Dependencies

### Critical Package (Exact Version)
```bash
npm install --save-exact package-name
```

### Stable Package (Caret Range)
```bash
npm install package-name
```

### After Adding
```bash
npm run validate-deps
npm run build
npm run lint
```

## 🔄 Updating Dependencies

### Check What's Outdated
```bash
npm outdated
```

### Update Specific Package
```bash
npm update package-name
# or
npm install package-name@latest
```

### Update All Patches
```bash
npm update
```

### After Updating
```bash
npm run build
npm run lint
npm run e2e
npm run validate-deps
```

## 🔒 Version Pinning Rules

### ❌ Never Use
```json
{
  "package": "latest",  // ❌ Non-deterministic
  "package": "*",       // ❌ Wildcard
  "package": ">=1.0.0"  // ❌ No upper bound
}
```

### ✅ Use Instead

**Exact Version** (critical packages)
```json
{
  "next": "15.2.4",
  "@radix-ui/react-dialog": "1.1.4"
}
```

**Caret Range** (stable packages)
```json
{
  "react": "^19",
  "zod": "^3.25.76"
}
```

## 🛠️ Troubleshooting

### Validation Fails
```bash
# Run validation to see errors
npm run validate-deps

# Fix errors in package.json
# Run validation again
npm run validate-deps
```

### Lockfile Out of Sync
```bash
# Regenerate lockfile
rm package-lock.json
npm install

# Verify
npm ci
git diff package-lock.json
```

### Pre-commit Hook Blocks
```bash
# Check what's wrong
npm run validate-deps

# Fix errors
# Try commit again
git commit
```

### CI Fails on Dependencies
```bash
# Check CI logs for specific error
# Fix locally
npm run validate-deps

# Commit and push
git add package.json package-lock.json
git commit -m "fix: resolve dependency issues"
git push
```

## 📋 Update Process

### Monthly (Patches)
1. `npm outdated`
2. `npm update`
3. `npm run build && npm run lint`
4. `git commit -m "chore(deps): update patch versions"`

### Quarterly (Majors)
1. `npm outdated`
2. `npm install package@latest` (one at a time)
3. Review changelog
4. Update code if needed
5. Test extensively
6. `git commit -m "chore(deps): upgrade package to vX.0.0"`

### Immediate (Security)
1. `npm audit`
2. `npm audit fix`
3. Test
4. Deploy

## 🎯 Best Practices

### ✅ Do
- Use exact versions for critical packages
- Use caret ranges for stable packages
- Commit lockfiles
- Update regularly
- Test after updates
- Use `npm ci` in CI

### ❌ Don't
- Use `latest` or `*`
- Ignore lockfile conflicts
- Update all at once
- Skip testing
- Use `npm install` in CI

## 🔍 Useful Commands

```bash
# Check package info
npm info package-name

# Check bundle size
npx bundle-phobia package-name

# List installed versions
npm list --depth=0

# Verify lockfile integrity
npm ci

# Clean install
rm -rf node_modules package-lock.json
npm install
```

## 📚 Documentation

- [Full Policy](./DEPENDENCY_MANAGEMENT.md) - Complete documentation
- [Implementation Summary](../ISSUE_499_IMPLEMENTATION_SUMMARY.md) - Technical details

## 🆘 Need Help?

1. Check [Troubleshooting](#troubleshooting) above
2. Review [Full Policy](./DEPENDENCY_MANAGEMENT.md)
3. Ask the team

---

**Print this and keep it handy!** 📋
