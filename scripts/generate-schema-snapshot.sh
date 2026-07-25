#!/usr/bin/env bash
# Generate supabase/schema.snapshot.sql from the local database after applying migrations.
# Requires: Docker + Supabase CLI running (supabase start && supabase db push)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOT="${ROOT_DIR}/supabase/schema.snapshot.sql"

cd "${ROOT_DIR}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI not found. Install via: npm i -g supabase" >&2
  exit 1
fi

echo "Applying migrations to local database..."
supabase db push

echo "Dumping schema-only snapshot to ${SNAPSHOT}..."
supabase db dump --local --schema-only -f "${SNAPSHOT}"

echo "OK: Schema snapshot updated. Commit supabase/schema.snapshot.sql with your migration changes."
