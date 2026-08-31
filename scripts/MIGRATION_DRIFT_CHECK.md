# Migration Drift Check

## Overview

This script detects drift between `backend/migrations` and `supabase/migrations` folders to ensure schema changes cannot silently diverge.

## Usage

```bash
# Run the drift check
node scripts/check-migration-drift.js

# Or with npm script
npm run check:migrations
```

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | No drift detected |
| 1 | Drift detected (conflicts or duplicates found) |
| 2 | Error occurred |

## What It Checks

1. **Duplicate Migrations**: Identical migration files in both folders
2. **Table Conflicts**: Same tables created/modified in different migrations
3. **Index Overlap**: Common indexes across migration folders
4. **Policy Conflicts**: RLS policies defined in multiple places

## Ownership Rules

| Directory | Purpose | Owner |
|-----------|---------|-------|
| `supabase/migrations` | Core schema, Auth, RLS policies | Frontend/Supabase team |
| `backend/migrations` | Backend-specific tables, RPC functions | Backend team |

## Migration Workflow

1. **New Schema Changes**:
   - Core tables → `supabase/migrations`
   - Backend-specific → `backend/migrations`
   
2. **Before Creating Migration**:
   - Run `node scripts/check-migration-drift.js`
   - Ensure no conflicts with existing migrations
   
3. **CI Check**:
   - Add to your CI pipeline to prevent drift
   - See `.github/workflows/migrations.yml` for reference

## Integration

### GitHub Actions

```yaml
name: Migration Drift Check
on: [pull_request]
jobs:
  check-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run migration drift check
        run: node scripts/check-migration-drift.js
```

### Pre-commit Hook

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/sh
node scripts/check-migration-drift.js
```

## Current State

As of the last check:
- **Backend migrations**: 19 files
- **Supabase migrations**: 27 files
- **Known duplicates**: 4 pairs identified

### Known Duplicates (to be consolidated)

| Backend File | Supabase File | Action |
|--------------|---------------|--------|
| `create_audit_logs.sql` | `20240101000000_create_audit_logs.sql` | Consolidate to supabase |
| `create_renewal_tables.sql` | `20240102000000_create_renewal_tables.sql` | Consolidate to supabase |
| `create_team_invitations.sql` | `20240103000000_create_team_invitations.sql` | Consolidate to supabase |
| `add_pause_columns.sql` | `20240118000000_add_pause_columns.sql` | Consolidate to supabase |