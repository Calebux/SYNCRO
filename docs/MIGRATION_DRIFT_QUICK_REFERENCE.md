# Migration Drift Checks — Quick Reference

## Common Commands

```bash
# Check for migration drift (file-only)
npm run check:migrations

# Check with database verification
npm run check:migrations:verify-db

# Inspect database migration state
npm run validate:migration-state

# Compare with filesystem
npm run validate:migration-state --compare-files

# Get JSON output (for tooling)
npm run check:migrations --json

# Run migration tests
npm run test:migrations
```

## Issue Types & Fixes

| Issue | Severity | Fix |
|-------|----------|-----|
| **DUPLICATE** | ERROR | Remove one copy, keep canonical file |
| **CONFLICT** | WARNING | Consolidate to single source (supabase/migrations/) |
| **UNAPPLIED_MIGRATION** | WARNING | Run `npm run db:migrate` |
| **ORPHANED_MIGRATION** | WARNING | Restore file or clean database history |

## Before Committing

```bash
npm run check:migrations
# Fix any errors before committing
```

## Before Pushing

```bash
npm run check:migrations:verify-db
# Fix any issues, ensure database is in sync
```

## CI Will

1. ✅ Run file check on every PR with migration changes
2. 📊 Run optional database check on main branch
3. 💬 Post results as PR comments
4. 🔗 Link to remediation guide if issues found

## Remediation Guides

- **All issue types:** `docs/MIGRATION_REMEDIATION.md`
- **Feature overview:** `docs/MIGRATION_DRIFT_CHECKING.md`

## JSON Output

```bash
npm run check:migrations --json
# Output includes:
# - fileCheck: file-level analysis results
# - dbCheck: database verification results (if --verify-db)
# - issues: detailed list of found issues
# - success: overall pass/fail status
```

## Environment Setup

For database checks (`--verify-db`):

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
npm run check:migrations:verify-db
```

## Emergency Reference

**Everything working?**
```bash
npm run check:migrations
# Should output: ✅ No migration drift detected.
```

**Something broken?**
1. Read the error message
2. Find your issue type in `docs/MIGRATION_REMEDIATION.md`
3. Follow the step-by-step fix
4. Verify with `npm run check:migrations:verify-db`

**Need more info?**
- `docs/MIGRATION_DRIFT_CHECKING.md` — Full feature guide
- `docs/MIGRATION_REMEDIATION.md` — Detailed fixes
- Test cases in `backend/tests/migration-drift.test.ts` — Example scenarios

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Database connection failed" | Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY |
| "Migration syntax error" | Check SQL syntax: `sqlcheck < migration.sql` |
| "Too many conflicts" | See MIGRATION_REMEDIATION.md → Comprehensive Troubleshooting |
| "Tests failing" | Run `npm run test:migrations` for details |

---

**Last Updated:** Issue #657 Implementation

For detailed information, see the full documentation in `docs/`.
