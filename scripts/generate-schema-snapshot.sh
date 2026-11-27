#!/usr/bin/env bash
# Generate supabase/schema.snapshot.sql from the local database after applying migrations,
# then refresh JSON + TypeScript row types from the migration-derived snapshot.
# Requires: Docker + Supabase CLI running (supabase start && supabase db push)
# SQL dump is optional; JSON/types always generate from supabase/migrations.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOT="${ROOT_DIR}/supabase/schema.snapshot.sql"

cd "${ROOT_DIR}"

if command -v supabase >/dev/null 2>&1; then
  echo "Applying migrations to local database..."
  supabase db push

  echo "Dumping schema-only snapshot to ${SNAPSHOT}..."
  supabase db dump --local --schema-only -f "${SNAPSHOT}"

  echo "OK: Schema SQL snapshot updated."
else
  echo "WARN: supabase CLI not found; skipping SQL dump. Generating types from migrations instead."
fi

echo "Generating schema JSON + TypeScript row types from supabase/migrations..."
node "${ROOT_DIR}/scripts/generate-db-types.mjs"

echo "OK: Commit supabase/schema.snapshot.json, shared/src/generated/database.ts, and schema.snapshot.sql (if dumped) with your migration changes."
