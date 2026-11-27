#!/usr/bin/env bash
# check-rls.sh
# CI script: fails if any public table has RLS disabled.
# Usage: DATABASE_URL=<url> ./scripts/check-rls.sh
#
# Requires psql. Set DATABASE_URL to your Supabase connection string.
# In CI, set DATABASE_URL as a secret environment variable.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

echo "Running RLS audit..."

MISSING=$(psql "$DATABASE_URL" --tuples-only --no-align -c "
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
    AND rowsecurity = false
  ORDER BY tablename;
")

if [ -n "$MISSING" ]; then
  echo ""
  echo "FAIL: The following public tables have RLS DISABLED:" >&2
  echo "$MISSING" >&2
  echo ""
  echo "Every public table must have RLS enabled." >&2
  echo "Add 'ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;' to the migration script." >&2
  exit 1
fi

echo "PASS: All public tables have RLS enabled."
exit 0
