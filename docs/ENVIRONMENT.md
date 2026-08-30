# Environment Variable Strategy

Canonical reference for how environment variables are defined, documented, and
validated across every package in this repository (issue #601).

## Principles

1. **One source of truth per package.** Each runtime package owns a
   `scripts/env.manifest.js` that lists its `required` and `optional` variable
   **names**. Everything else (validators, `.env.example`, this doc) is checked
   against the manifest.
2. **Validation for every runtime package.** No package boots or builds without
   its required vars present.
3. **CI fails fast.** Drift between a manifest and its `.env.example` fails on
   every PR; missing required *secrets* fail on pushes to protected branches.
4. **Never document a value in only one place.** Adding a var touches the
   manifest, the schema (if centrally validated), `.env.example`, and this doc.

## Package matrix

| Package        | Env file              | Validation                                                            | Notes |
|----------------|-----------------------|----------------------------------------------------------------------|-------|
| **backend**    | `backend/.env.example`| zod schema `backend/src/config/env.ts` (at boot) + `backend/scripts/validate-env.js` | Manifest: `backend/scripts/env.manifest.js` |
| **client**     | `client/.env.example` | zod helper `client/lib/api/env.ts` (runtime) + `client/scripts/validate-env.js` (prebuild) | Manifest: `client/scripts/env.manifest.js` |
| **sdk**        | — (none)              | No runtime env. Configured via the client constructor (`new SyncroClient({ apiKey, baseUrl })`). | Library |
| **shared**     | — (none)              | No runtime env. | Library |
| **contracts**  | — (none)              | No runtime env in build/test. Deploy scripts read CLI args / Stellar keys at invocation time. | Rust/Soroban |
| **quota_guard**| — (none)              | No runtime env. | Python helper |
| root `app/`    | — (none)              | No runtime env. Legacy/secondary Next surface; primary frontend is `client/`. | See "Known follow-ups" |

The repo-wide check `scripts/check-env-docs.js` enforces this matrix: env
packages must have a manifest + `.env.example` that agree; no-env packages must
**not** sprout one without being moved into the matrix.

## Required variables

### Backend (required to boot — `backend/src/config/env.ts`)

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`JWT_SECRET`, `ADMIN_API_KEY`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`STELLAR_NETWORK_URL`, `SOROBAN_CONTRACT_ADDRESS`.

`STRIPE_*` are optional (payments can be disabled); `PORT`, `NODE_ENV`,
`FRONTEND_URL`, and the feature flags have defaults. The full list lives in
`backend/scripts/env.manifest.js`. Production additionally enforces mainnet
Stellar settings — see `backend/src/config/env.ts` and
[blockchain-feature-flags.md](./blockchain-feature-flags.md).

### Backend cache tuning (issue #1092)

Redis TTL caching is used for both FX rates and merchant metadata.  All
variables are optional with safe defaults and are documented in
`backend/.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `EXCHANGE_RATE_TTL_MS` | `900000` (15 min) | Live TTL for FX-rate Redis entries |
| `EXCHANGE_RATE_CACHE_JITTER_FACTOR` | `0.1` | Random jitter (0–1) added to TTL to avoid stampedes |
| `EXCHANGE_RATE_CACHE_SWR_FACTOR` | `0.5` | Stale-while-revalidate window as a fraction of TTL |
| `MERCHANT_CACHE_TTL_MS` | `1800000` (30 min) | Live TTL for merchant-metadata Redis entries |

Jitter and SWR factors are shared by both services through `RedisCacheAdapter`.
Set `EXCHANGE_RATE_CACHE_SWR_FACTOR=0` to disable stale-while-revalidate.

### Client (required to build — `client/scripts/env.manifest.js`)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_API_URL`, `STRIPE_SECRET_KEY`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

## Naming conventions

- **`NEXT_PUBLIC_*`** is inlined into the browser bundle at build time. **Never**
  put a secret behind a `NEXT_PUBLIC_` name. Non-prefixed client vars are
  server-only (`client/app/api/*`, middleware).
- **`NEXT_PUBLIC_API_URL`** is the canonical backend base-URL name.
  **`NEXT_PUBLIC_API_BASE`** is **deprecated** — still read as a fallback so
  existing deployments keep working, but new config must use
  `NEXT_PUBLIC_API_URL`. Plan to remove the fallback once all environments are
  migrated.

## CI enforcement model

The `validate-env` job in `.github/workflows/ci.yml`:

- **Structural step (every run — PRs + pushes):** runs
  `scripts/check-env-docs.js` plus `validate-env.js --structural` for backend
  and client. No secrets required; fails on any manifest ↔ `.env.example` drift.
  Forked/contributor PRs are never blocked by absent secrets.
- **Strict step (`push` to `main`/`develop` only):** injects the real secrets
  and runs `validate-env.js` (no flag). Hard-fails if any required var is
  missing. The validators no longer bypass failure when `CI` is set.

## How to add a new environment variable

1. Add the name to the package's `scripts/env.manifest.js` (`required` or
   `optional`).
2. If the backend validates it centrally, add a field to the zod schema in
   `backend/src/config/env.ts` (required ⇔ no `.optional()`/`.default()` — the
   parity test enforces this).
3. Document it in the package's `.env.example` with a placeholder.
4. Update this file if it changes the required set or conventions.
5. If it's a new **required secret**, add it to the strict CI step's `env:`
   block and to your deployment provider (Vercel / Render / GitHub secrets).

Run locally before pushing:

```bash
node scripts/check-env-docs.js                  # repo-wide drift check
node backend/scripts/validate-env.js --structural
node client/scripts/validate-env.js --structural
```

## Known follow-ups (out of scope for #601)

- The root `app/` directory has no `package.json` and no `next` dependency and
  consumes no env; it appears vestigial next to `client/`. Consolidating or
  removing it is tracked separately.
