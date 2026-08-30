# Repository Issue Backlog — May 2026

> **Roadmap:** Issue clusters and MVP exit criteria live in [ROADMAP.md](./ROADMAP.md).

## #35 — [P0] Eliminate accidental service-role usage from client server code

**Scope:** client-api
**Priority:** P0

**Summary:**
The client package included `SUPABASE_SERVICE_ROLE_KEY` in its environment configuration schema and validation script. This made the privileged service-role key accessible to any Next.js API route importing `@/lib/api/env`, creating a vector for accidental privilege escalation.

**Resolution:**
- Removed `SUPABASE_SERVICE_ROLE_KEY` from `client/lib/api/env.ts` schema and parser
- Removed `SUPABASE_SERVICE_ROLE_KEY` from `client/scripts/validate-env.js` required vars list
- Removed docs references in `client/README.md` and `client/BACKEND_DOCUMENTATION.md`
- Added test coverage (`client/lib/api/env.test.ts`) confirming the key is excluded
- The `backend/` package retains its own `SUPABASE_SERVICE_ROLE_KEY` usage (justified — backend needs admin privileges for auth admin operations and internal services)

**Service-role justification in backend:**
- `backend/lib/supabase.ts` — direct service-role client for backend-internal DB access
- `backend/src/config/database.ts` — service-role client with connection pool monitoring
- `backend/src/routes/user.ts:104` — `supabase.auth.admin.deleteUser()` requires admin privileges
- `scripts/*` — admin-level RLS audit scripts (offline use only)

## #697 — [P2] Tighten bundle-size budgets for the client app

**Scope:** ops
**Priority:** P2

**Summary:**
The repo had a bundle-size CI workflow but it was rudimentary — it measured the total `.next` directory size via `du -sk` and posted a raw KB comment with no per-route analysis, no baseline comparison, and no budget enforcement. This made it easy for bundle regressions to slip through unnoticed.

**Resolution:**
- Added `@next/bundle-analyzer` to client devDependencies and wired it into `next.config.mjs` via the `ANALYZE=true` environment variable
- Created `client/bundle-size.json` with route-level and chunk-level budgets for all 16 UI routes
- Created `client/scripts/check-bundle-size.js` that reads the Next.js build manifest, resolves per-route JS chunks from `.next/static/chunks/app/`, measures actual file sizes, and compares against defined budgets
- Rewrote `.github/workflows/bundle-size.yml` to:
  - Build from the `client/` directory with `npm ci` (fixed broken pnpm setup)
  - Run the check script with `--json` output
  - Post a detailed PR comment with per-route breakdown, violations, and warnings
  - Fail CI on any budget violation
- Added test coverage (`client/__tests__/lib/check-bundle-size.test.ts`) for the core `checkBudgets`, `routeToChunkPrefix`, and `formatKB` functions
- Updated `client/docs/TEST_INFRASTRUCTURE.md` with bundle-size workflow documentation

**Key files:**
- `client/bundle-size.json` — budget definitions
- `client/scripts/check-bundle-size.js` — budget enforcement script
- `client/next.config.mjs` — conditional bundle analyzer integration
- `.github/workflows/bundle-size.yml` — CI workflow
- `client/__tests__/lib/check-bundle-size.test.ts` — unit tests

## #598 — [P0] Unify conflicting Next.js configuration files

**Scope:** architecture
**Priority:** P0

**Summary:**
The repo contained three conflicting Next.js config files: a root-level `next.config.js` (stale CJS, no Sentry/images/headers), a root-level `next.config.ts` (empty placeholder), and `client/next.config.mjs` (the complete, production config). Next.js picks up the first config it finds, so the stale root-level files could silently override the real config.

**Resolution:**
- Deleted `next.config.js` (root) — stale CJS config with only bundle-analyzer and reactStrictMode
- Deleted `next.config.ts` (root) — empty placeholder with no configuration
- Retained `client/next.config.mjs` as the sole active config (Sentry, images, headers, reactCompiler, bundle analyzer)
- Added CI verification step to `.github/workflows/ci.yml` (`validate-dependencies` job) that asserts no root-level `next.config.*` exists and exactly one config (`next.config.mjs`) exists under `client/`
- Added `client/__tests__/next-config.test.ts` with 9 tests verifying the unified config shape (file existence, no stale configs, Sentry wrapping, images, headers, reactCompiler, bundle analyzer, ESM export)

**Key files:**
- `client/next.config.mjs` — sole active Next.js config
- `.github/workflows/ci.yml` — CI enforcement step
- `client/__tests__/next-config.test.ts` — test coverage
