# Migration Drift Checking

## Overview

This document describes the enhanced migration drift checking system for the SYNCRO repository. It helps detect and prevent divergence between the `backend/migrations` and `supabase/migrations` directories and validates that applied migrations match the filesystem.

## Quick Start

### File-Only Drift Check (Fastest)
```bash
npm run check:migrations
```

### Full Verification (File + Database)
```bash
npm run check:migrations --verify-db
```

### JSON Output (for CI/tooling)
```bash
npm run check:migrations --json
npm run check:migrations --verify-db --json
```

## Tools

### 1. Enhanced Drift Check Script (`scripts/check-migration-drift.js`)

Performs static file analysis and optional database verification.

**Modes:**
- **File-only** (default): Compares migration files, detects duplicates and conflicts
- **Database verification** (`--verify-db`): Also checks that applied migrations match filesystem

**Features:**
- Normalizes SQL (removes comments, whitespace) for accurate comparison
- Extracts and compares table, index, and policy names
- Identifies duplicate migrations (identical SQL in different files)
- Identifies conflicts (different migrations affecting the same tables)
- Optional database state verification

**Output Formats:**
- Human-readable (default)
- JSON (`--json`)

**Exit Codes:**
- `0`: No drift detected
- `1`: Drift detected (errors found)
- `2`: Error occurred (connection, syntax, etc.)

**Example Usage:**
```bash
# File check only
node scripts/check-migration-drift.js

# With database verification
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-migration-drift.js --verify-db

# JSON output
node scripts/check-migration-drift.js --json > drift-report.json
```

### 2. Migration State Validator (`scripts/validate-migration-state.js`)

Standalone utility to inspect the actual database migration state. Useful for:
- Comparing applied migrations across environments
- Debugging unapplied or orphaned migrations
- Validating database consistency

**Features:**
- Fetches applied migration history from database
- Lists database tables
- Compares filesystem migrations with applied state
- Supports multiple environments

**Output Formats:**
- Human-readable (default)
- JSON (`--json`)

**Exit Codes:**
- `0`: Validation successful
- `1`: Issues found
- `2`: Error occurred

**Example Usage:**
```bash
# Check current database state
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/validate-migration-state.js

# Compare with filesystem
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/validate-migration-state.js --compare-files

# JSON output for parsing
node scripts/validate-migration-state.js --json | jq '.appliedMigrations'
```

## CI/CD Integration

### GitHub Actions Workflow

The workflow in `.github/workflows/migration-drift-check.yml` includes:

1. **File-level drift check** (always runs)
   - Compares `backend/migrations/` and `supabase/migrations/`
   - Posts PR comment with results
   - Blocks merge if duplicates found

2. **Database verification** (optional, requires secrets)
   - Verifies applied migrations against filesystem
   - Only runs on main branch or if `ENABLE_DB_VERIFICATION=true` repo variable
   - Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets

### Enabling Database Verification in CI

1. Set repository variable: `ENABLE_DB_VERIFICATION` = `true`
2. Ensure secrets are configured:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Service role key (for admin access)

The database check will then run on every PR and main branch push that modifies migrations.

## Types of Drift

### Duplicate Migrations (ERROR)
Two migration files contain identical SQL.

**Example:**
```
❌ ERRORS (must fix):
  [DUPLICATE] Identical migrations: "001_init.sql" and "001_init_backup.sql"
```

**Fix:** Remove one of the files, keep the canonical version.
See [MIGRATION_REMEDIATION.md](./MIGRATION_REMEDIATION.md#case-1-duplicate-migrations)

### Conflict Migrations (WARNING)
Different migrations modify the same table(s).

**Example:**
```
⚠️  WARNINGS (review recommended):
  [CONFLICT] Common tables in different migrations: "001_create_users.sql" and 
  "002_alter_users.sql" affect tables: users
```

**Fix:** Consolidate migrations to a single source. See [MIGRATION_REMEDIATION.md](./MIGRATION_REMEDIATION.md#case-2-conflict-migrations)

### Unapplied Migrations (WARNING - Database Check)
A migration exists in the filesystem but hasn't been applied to the database.

**Example:**
```
=== Database Verification Issues ===
  [UNAPPLIED_MIGRATION] Migration in filesystem but not applied to database: "20260529_new_feature.sql"
```

**Fix:** Run `npm run db:migrate` to apply pending migrations.
See [MIGRATION_REMEDIATION.md](./MIGRATION_REMEDIATION.md#case-3-unapplied-migrations-local-development)

### Orphaned Migrations (WARNING - Database Check)
A migration has been applied to the database but doesn't exist in the filesystem.

**Example:**
```
=== Database Verification Issues ===
  [ORPHANED_MIGRATION] Migration in database but not in filesystem: "20260101_old_removed.sql"
```

**Fix:** Either restore the migration file or clean up the database history.
See [MIGRATION_REMEDIATION.md](./MIGRATION_REMEDIATION.md#case-5-orphaned-migrations-database-has-migration-filesystem-doesnt)

## Understanding the Output

### File-Only Check Output
```
🔍 Checking migration drift between backend and supabase...

=== Migration Analysis ===

Backend migrations: 29 files
Supabase migrations: 28 files

✅ No migration drift detected.

--- Summary ---
Total backend tables: 45
Total supabase tables: 47
```

### Database Verification Output
```
=== Database Verification Issues ===

  [UNAPPLIED_MIGRATION] Migration in filesystem but not applied to database: "20260529_new_feature.sql"
  [ORPHANED_MIGRATION] Migration in database but not in filesystem: "20260101_removed.sql"
```

### JSON Output Format
```json
{
  "success": true,
  "fileCheck": {
    "backendCount": 29,
    "supabaseCount": 28,
    "backendTableCount": 45,
    "supabaseTableCount": 47,
    "errors": 0,
    "warnings": 0
  },
  "dbCheck": {
    "appliedCount": 57,
    "filesystemCount": 57,
    "issues": [],
    "appliedMigrations": [
      {
        "name": "20240101000000_create_audit_logs.sql",
        "executedAt": "2024-01-01T00:00:00Z"
      }
    ]
  },
  "issues": []
}
```

## Best Practices

### 1. Use a Single Source of Truth
Choose **one** authoritative location for migrations:
- Option A (Recommended): All migrations in `supabase/migrations/`
- Option B: All migrations in `backend/migrations/`

Never maintain parallel migration trees.

### 2. Check Before Committing
```bash
npm run check:migrations
```

### 3. Check Before Pushing
```bash
npm run check:migrations --verify-db
```

### 4. Review Migration Files in PRs
```bash
git diff HEAD~1..HEAD -- backend/migrations/ supabase/migrations/
```

### 5. Apply Migrations Locally
```bash
npm run db:migrate
npm run check:migrations --verify-db
```

### 6. Monitor CI Results
- Read drift check comments on PRs
- Fix issues before merging
- Don't ignore warnings

## Troubleshooting

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
# Validate SQL
sqlcheck < supabase/migrations/your_migration.sql

# Test with psql
psql "$DATABASE_URL" < supabase/migrations/your_migration.sql
```

### "Too many conflicts to resolve"
See [MIGRATION_REMEDIATION.md](./MIGRATION_REMEDIATION.md#comprehensive-troubleshooting)

## Related Documentation

- [MIGRATION_REMEDIATION.md](./MIGRATION_REMEDIATION.md) — Detailed fix procedures
- [backend/README.md](../backend/README.md) — Backend setup
- [supabase/README.md](../supabase/README.md) — Supabase setup

## Environment Variables

For database verification (`--verify-db`):

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (admin access) |
| `DATABASE_URL` | No | Direct Postgres URL (overrides Supabase) |

## Contributing

When adding new migrations:

1. Create the migration file in the canonical location (e.g., `supabase/migrations/`)
2. Write clear, idempotent SQL
3. Add comments explaining the change
4. Run local tests: `npm run check:migrations --verify-db`
5. Open PR and let CI verify
6. Address any drift issues before merging

## Support

For issues not covered here, see:
- [docs/MIGRATION_REMEDIATION.md](./MIGRATION_REMEDIATION.md)
- Issue tracker: Create a new issue with drift check output
