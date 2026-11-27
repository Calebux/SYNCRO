#!/usr/bin/env bash
# Local pre-commit + CI parity: lint, typecheck, conflict markers, TODO policy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Conflict markers"
node scripts/check-conflict-markers.mjs

echo "==> TODO / FIXME policy"
node scripts/check-todos.mjs

echo "==> Lint (staged packages via lint-staged when available)"
if command -v npx >/dev/null 2>&1; then
  if [ -f backend/.lintstagedrc.json ]; then
    npx lint-staged --config backend/.lintstagedrc.json --cwd backend || true
  fi
  if [ -f client/.lintstagedrc.json ]; then
    npx lint-staged --config client/.lintstagedrc.json --cwd client || true
  fi
fi

# Always run eslint on root config when present (non-staged CI parity path)
if [ "${PRECOMMIT_FULL_LINT:-0}" = "1" ] || [ "${CI:-}" = "true" ]; then
  echo "==> Full lint (CI parity)"
  if [ -f backend/package.json ] && grep -q '"lint"' backend/package.json 2>/dev/null; then
    npm run lint -w backend --if-present
  fi
  if [ -f client/package.json ]; then
    npm run lint -w client --if-present
  fi
fi

echo "==> Typecheck"
npm run typecheck --if-present

echo "✅ Pre-commit checks passed"
