# Migration Remediation Guide

## Overview

This guide provides step-by-step instructions for remediating migration drift issues detected by the migration drift check tools.

## Understanding Issue Types

### Duplicate Migrations
**Severity:** ERROR — Must be fixed before merging

Two migration files contain identical SQL. This usually indicates:
- A migration was copied by mistake
- The same migration was added to both `backend/migrations` and `supabase/migrations`

### Conflict Migrations
**Severity:** WARNING — Review before merging

Two different migrations modify the same table(s). While not always an error, it indicates:
- Schema changes are split across multiple locations
- Potential for state divergence between `backend/migrations` and `supabase/migrations`

### Unapplied Migrations
**Severity:** WARNING — Review database state

A migration exists in the filesystem but hasn't been applied to the database. This can occur:
- After pulling new migration files from git
- If a migration failed to apply in a previous deploy
- During local development before running `npm run db:migrate`

### Orphaned Migrations
**Severity:** WARNING — Clean up or recover

A migration has been applied to the database but doesn't exist in the filesystem. This usually means:
- A migration file was accidentally deleted
- The migration was added directly to the database without a corresponding file
- A rollback wasn't properly tracked

---

## Remediation Procedures

### Case 1: Duplicate Migrations

**Issue:** `Identical migrations: "001_init.sql" and "001_init_backup.sql"`

#### Step 1: Identify which copy is correct
```bash
# List all migration files
ls backend/migrations/
ls supabase/migrations/

# Compare the two files
diff backend/migrations/001_init.sql supabase/migrations/001_init.sql
```

#### Step 2: Keep the correct version
- If they're truly identical, keep the one in **`supabase/migrations/`** (canonical location)
- If they're different, keep both but rename to avoid duplication

#### Step 3: Remove the duplicate
```bash
# Remove from backend/migrations if it's truly identical
rm backend/migrations/001_init.sql

# Or remove from supabase/migrations (less common)
rm supabase/migrations/001_init.sql

git add -A
git commit -m "Remove duplicate migration 001_init.sql"
```

#### Step 4: Verify the fix
```bash
npm run check:migrations        # File check passes
npm run check:migrations --verify-db  # Database check passes
```

---

### Case 2: Conflict Migrations

**Issue:** `Common tables in different migrations: "001_create_users.sql" and "002_alter_users.sql" affect tables: users`

This often indicates that schema changes are split across incompatible migration paths.

#### Step 1: Understand the sequence
```bash
# View the content of both migrations
cat backend/migrations/001_create_users.sql
cat supabase/migrations/002_alter_users.sql
```

#### Step 2: Consolidate into a single path
Choose one authoritative location (`supabase/migrations/` is recommended):

```bash
# Option A: Copy all migrations to supabase/migrations, remove from backend
cp backend/migrations/*.sql supabase/migrations/
rm backend/migrations/*.sql

git add -A
git commit -m "Consolidate all migrations to supabase/migrations/"
```

Or:

```bash
# Option B: Keep backend/migrations, remove from supabase (less preferred)
cp supabase/migrations/*.sql backend/migrations/
rm supabase/migrations/*.sql

git add -A
git commit -m "Consolidate all migrations to backend/migrations/"
```

#### Step 3: Verify
```bash
npm run check:migrations
```

---

### Case 3: Unapplied Migrations (Local Development)

**Issue:** `Migration in filesystem but not applied to database: "20260529_new_feature.sql"`

This is common after pulling from git or creating new migrations.

#### Step 1: Apply the migration
```bash
# Push migrations to your local database
npm run db:migrate

# Or push to a specific database
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npm run db:migrate
```

#### Step 2: Verify
```bash
npm run check:migrations --verify-db
```

If the issue persists after `db:migrate`, the migration may have failed. Check logs:

```bash
# View Supabase logs
supabase logs --follow
```

---

### Case 4: Unapplied Migrations (CI Database)

**Issue:** Migration check fails in CI with unapplied migrations

#### Step 1: Check the CI database state
```bash
# Use the validation script to inspect the CI database
DATABASE_URL=<ci-db-url> node scripts/validate-migration-state.js --json
```

#### Step 2: Apply missing migrations
If the CI database is behind:

```bash
# Option A: Run migrations in CI pipeline (recommended)
# Update .github/workflows/migration-drift-check.yml to run migrations:
- name: Apply pending migrations
  run: npm run db:migrate
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

Or:

```bash
# Option B: Manually trigger migration in CI database (one-time fix)
npx supabase db push \
  --db-url "$CI_DATABASE_URL" \
  --password "$CI_DB_PASSWORD"
```

#### Step 3: Verify CI passes
Once migrations are applied, re-run CI checks.

---

### Case 5: Orphaned Migrations (Database has migration, filesystem doesn't)

**Issue:** `Migration in database but not in filesystem: "20260101_old_removed.sql"`

This indicates a migration was deleted from version control but remains in the database.

#### Step 1: Decide whether to restore or ignore

If the migration is **critical** (e.g., created a core table):
```bash
# Restore the migration file from git history
git log --all --pretty=format:"%H %s" | grep -i "20260101"

# Check out that version
git show <commit>:supabase/migrations/20260101_old_removed.sql > \
  supabase/migrations/20260101_old_removed.sql

git add supabase/migrations/20260101_old_removed.sql
git commit -m "Restore deleted migration 20260101_old_removed.sql"
```

If the migration is **safe to remove** (e.g., housekeeping, temporary test data):
```bash
# Manually delete from database (CAREFUL — requires admin access)
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/validate-migration-state.js
# Record the orphaned migration name
# Then remove it from supabase_migrations_history table via dashboard
```

#### Step 2: Verify
```bash
npm run check:migrations --verify-db
```

---

### Case 6: Cross-Environment Divergence

**Issue:** Local database applied migrations that CI database doesn't have (or vice versa)

CI automatically detects this via two parallel checks on every PR:
- **`verify-local-database` job** — spins up a fresh local Supabase stack and checks filesystem vs. applied state
- **`verify-database` job** — checks the CI remote database (requires `ENABLE_DB_VERIFICATION=true` on PRs, or runs automatically on pushes to `main`)

When these jobs produce different `appliedCount` values, it signals cross-environment divergence.

#### Step 1: Read the CI output

PR comments will show, per environment:

```
Applied: 10 | Filesystem: 12
[unapplied_migration] Migration in filesystem but not applied to database: "20260530_new_index.sql"
```

#### Step 2: Compare environments locally
```bash
# Check local environment
node scripts/check-migration-drift.js --verify-db --env local --json

# Check CI remote environment (if you have credentials)
SUPABASE_URL=<ci-url> SUPABASE_SERVICE_ROLE_KEY=<key> \
  node scripts/check-migration-drift.js --verify-db --env ci-remote --json

# Validate raw migration state in either environment
node scripts/validate-migration-state.js --json
```

#### Step 3: Align the databases

If **local is behind CI** (CI has more applied migrations):
```bash
# Pull the latest migrations from git
git pull origin main

# Apply them locally
npm run db:migrate
```

If **local is ahead of CI** (local applied migrations CI hasn't seen):
```bash
# Don't merge the PR until CI catches up.
# Push the pending migrations to the CI database:
npm run db:migrate:prod --db-url "$CI_DATABASE_URL"
```

If **both environments are missing the same migration** (filesystem has it, neither DB has it):
```bash
# Apply to local
npm run db:migrate

# CI will auto-apply on next pipeline run
```

#### Step 4: Verify both environments match
```bash
node scripts/check-migration-drift.js --verify-db --env local --json
```

---

### Case 7: CI Drift Check Finds Issues Not Present Locally

**Issue:** `verify-local-database` CI job passes but `verify-database` (CI remote) fails with orphaned or unapplied migrations

This means the CI remote database has diverged from the filesystem — likely because:
- A migration was applied to the CI database manually (outside of version control)
- A migration file was deleted from git after being deployed
- The CI database has never been reset and accumulated ad-hoc changes

#### Step 1: Identify the discrepancy
```bash
# From CI logs, note the orphaned migrations reported by verify-database job
# Example: [orphaned_migration] Migration in database but not in filesystem: "20260101_adhoc.sql"
```

#### Step 2: Decide — restore or remove the orphan

If the migration **must be preserved** (it created schema your app depends on):
```bash
# Recreate the migration file from git history or database introspection
git log --all --oneline -- supabase/migrations/
# Or inspect the database directly to recreate the SQL
```

If the migration is **safe to remove** (temporary, already superseded):
```bash
# Remove from supabase_migrations_history via the Supabase dashboard
# Dashboard > Table Editor > supabase_migrations_history > delete row
```

#### Step 3: Verify CI passes
Re-run the `verify-database` job via `ENABLE_DB_VERIFICATION=true` on the PR or push to `main`.

---

## Comprehensive Troubleshooting

### "Database connection failed"

```bash
# Verify environment variables
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY

# Test connection
curl -X POST "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT 1"}'
```

### "Migration syntax error"

```bash
# Check migration file for SQL syntax errors
cat supabase/migrations/20260529_your_migration.sql

# Validate SQL
sqlcheck < supabase/migrations/20260529_your_migration.sql

# Test locally with psql
psql "$DATABASE_URL" < supabase/migrations/20260529_your_migration.sql
```

### "Too many migration conflicts to resolve manually"

```bash
# Rebuild from scratch (caution: production data loss)
# Only for development databases

# 1. Back up if needed
pg_dump "$DATABASE_URL" > backup.sql

# 2. Reset and reapply
npm run db:reset
npm run db:migrate

# Or re-initialize from git
rm -rf backend/migrations supabase/migrations
git checkout backend/migrations supabase/migrations
npm run db:migrate
```

---

## Prevention Tips

1. **Use a single source of truth**: Choose either `backend/migrations/` OR `supabase/migrations/`, not both
2. **Automate checks**: Ensure drift check runs in CI on every PR
3. **Review migration history**: Before merging, inspect actual migrations:
   ```bash
   git diff HEAD~1..HEAD -- backend/migrations/ supabase/migrations/
   ```
4. **Test locally first**: Always apply migrations locally before opening a PR:
   ```bash
   npm run db:migrate
   npm run check:migrations --verify-db
   ```
5. **Document schema changes**: Add comments to migrations explaining what they do
6. **Monitor CI**: Set up alerts for failed migration checks

---

## Getting Help

If you encounter issues not covered here:

1. Check recent migration files for obvious errors
2. Review git log for recent changes:
   ```bash
   git log -p -- backend/migrations/ supabase/migrations/ | head -100
   ```
3. Run the validation script in verbose mode:
   ```bash
   node scripts/validate-migration-state.js --json | jq '.issues[] | select(.severity=="error")'
   ```
4. Consult the database logs:
   ```bash
   supabase logs
   ```

---

## Related Commands

```bash
# File-only drift check (fastest)
npm run check:migrations

# File + database drift check
npm run check:migrations --verify-db

# Validate current database state
node scripts/validate-migration-state.js

# Create a new migration
npm run db:new

# Apply migrations
npm run db:migrate

# Reset local database (development only)
npm run db:reset
```
