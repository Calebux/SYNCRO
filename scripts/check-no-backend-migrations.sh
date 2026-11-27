#!/bin/bash
# =============================================================
# scripts/check-no-backend-migrations.sh
#
# CI guard: ensures no active SQL migration files exist in
# backend/migrations/. All migrations must live in supabase/migrations/.
# Part of Issue #655 fix - single source of truth for migrations.
# =============================================================

set -euo pipefail

BACKEND_MIGRATIONS_DIR="backend/migrations"

echo "Checking for active migrations in backend/migrations/ ..."

ACTIVE_COUNT=$(find "${BACKEND_MIGRATIONS_DIR}" -maxdepth 1 -name "*.sql" 2>/dev/null | wc -l | tr -d ' ')

if [ "${ACTIVE_COUNT}" -gt 0 ]; then
  echo ""
  echo "ERROR: Found ${ACTIVE_COUNT} active SQL file(s) in ${BACKEND_MIGRATIONS_DIR}/:"
  find "${BACKEND_MIGRATIONS_DIR}" -maxdepth 1 -name "*.sql"
  echo ""
  echo "All database migrations must live in supabase/migrations/."
  echo "Move any new migration files there and run: supabase db push"
  exit 1
fi

echo "OK: No active migration files found in ${BACKEND_MIGRATIONS_DIR}/."
echo "All migrations are correctly owned by supabase/migrations/."
exit 0
