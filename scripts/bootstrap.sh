#!/usr/bin/env bash
set -euo pipefail

# Bootstrap the local stack: install deps, start infra, run migrations, seed v3 demo data.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Installing dependencies"
npm install

echo "==> Starting infrastructure"
if command -v docker >/dev/null 2>&1; then
  docker compose up -d
else
  echo "docker not found; skipping infra startup" >&2
fi

echo "==> Running migrations"
npm run migrate

echo "==> Seeding v3 demo data"
npm run seed:v3

echo "==> Bootstrap complete"
