# Environment Variables Matrix (#113)

Single source of truth for every environment variable used across the Synchro stack.

**Columns:**
- **Variable** – exact name as used in code
- **Component** – `client` | `backend` | `both`
- **Owner** – team or system responsible for provisioning
- **Environment** – `all` | `production` | `development`
- **Secret?** – whether the value must be kept out of source control
- **Required?** – whether the app fails to start without it
- **Description**

---

## Supabase

| Variable | Component | Owner | Environment | Secret? | Required? | Description |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client | Platform | all | No | Yes | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | Platform | all | No | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | client, backend | Platform | all | **Yes** | Yes | Service role key – bypasses RLS; server-side only |
| `SUPABASE_URL` | backend | Platform | all | No | Yes | Supabase project URL for backend |

---

## API / Backend

| Variable | Component | Owner | Environment | Secret? | Required? | Description |
|---|---|---|---|---|---|---|
| `PORT` | backend | Ops | all | No | No | HTTP port (default: 3001) |
| `NODE_ENV` | both | Ops | all | No | No | `development` \| `production` \| `test` (default: `development`) |
| `FRONTEND_URL` | backend | Ops | all | No | No | Allowed CORS origin (default: `http://localhost:3000`) |
| `ADMIN_API_KEY` | backend | Ops | all | **Yes** | Yes | Key for admin-only endpoints |
| `NEXT_PUBLIC_API_BASE` | client | Ops | all | No | Yes | Backend API base URL |
| `API_SECRET_KEY` | client | Ops | all | **Yes** | Yes | Shared secret for client→backend requests |
| `JWT_SECRET` | client | Ops | all | **Yes** | Yes (prod) | JWT signing secret (min 32 chars) |
| `ENCRYPTION_KEY` | client | Ops | all | **Yes** | Yes (prod) | Encryption key for sensitive data (min 32 chars) |
| `LOG_LEVEL` | both | Ops | all | No | No | `debug` \| `info` \| `warn` \| `error` (default: `info`) |
| `MAINTENANCE_MODE` | client | Ops | all | No | No | `true` \| `false` (default: `false`) |

---

## Rate Limiting / Redis

| Variable | Component | Owner | Environment | Secret? | Required? | Description |
|---|---|---|---|---|---|---|
| `RATE_LIMIT_ENABLED` | client | Ops | all | No | No | Enable rate limiting (default: `true`) |
| `RATE_LIMIT_REDIS_URL` | client | Ops | production | **Yes** | No | Redis connection URL. If absent, falls back to in-memory (see fault-injection docs) |

---

## Payment Providers

| Variable | Component | Owner | Environment | Secret? | Required? | Description |
|---|---|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | client | Finance | all | **Yes** | No | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | client | Finance | all | **Yes** | No | Stripe webhook signing secret |
| `PAYSTACK_SECRET_KEY` | client | Finance | all | **Yes** | No | Paystack secret key |

---

## Blockchain / Stellar

| Variable | Component | Owner | Environment | Secret? | Required? | Description |
|---|---|---|---|---|---|---|
| `SOROBAN_CONTRACT_ADDRESS` | backend | Blockchain | all | No | Yes (if blockchain enabled) | Deployed Soroban contract address |
| `STELLAR_NETWORK_URL` | backend | Blockchain | all | No | Yes (if blockchain enabled) | Soroban RPC URL (testnet or mainnet) |
| `STELLAR_SECRET_KEY` | backend | Blockchain | all | **Yes** | Yes (if blockchain enabled) | Stellar account secret key for signing transactions |

---

## Push Notifications

| Variable | Component | Owner | Environment | Secret? | Required? | Description |
|---|---|---|---|---|---|---|
| `VAPID_PUBLIC_KEY` | backend | Ops | all | No | Yes (if push enabled) | VAPID public key for Web Push |
| `VAPID_PRIVATE_KEY` | backend | Ops | all | **Yes** | Yes (if push enabled) | VAPID private key for Web Push |
| `VAPID_SUBJECT` | backend | Ops | all | No | No | VAPID subject (mailto: or URL, default: `FRONTEND_URL`) |

---

## Monitoring

| Variable | Component | Owner | Environment | Secret? | Required? | Description |
|---|---|---|---|---|---|---|
| `SENTRY_DSN` | client | Ops | production | No | No | Sentry error tracking DSN |
| `ANALYTICS_ID` | client | Ops | production | No | No | Analytics provider ID |

---

## Validation

### Client
The client validates env vars at startup via `client/lib/api/env.ts` (Zod schema).
- In `production`, missing required vars throw and prevent startup.
- In `development`, missing vars log a warning and return a partial env object.

### Backend
The backend validates env vars at startup via `backend/src/config/env.ts` (Zod schema).
- Missing required vars throw and prevent startup in all environments.
- Run `npm run validate:env` to check without starting the server.

### CI
Add this step to your CI pipeline to catch missing vars early:

```yaml
- name: Validate environment variables
  run: |
    cd backend && npm run validate:env
```

---

## Missing Variables Behaviour

| Scenario | Behaviour |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` missing | Client throws at startup (production) |
| `SUPABASE_SERVICE_ROLE_KEY` missing | All authenticated API calls fail with 500 |
| `ADMIN_API_KEY` missing | Admin endpoints use insecure default (dev only) |
| `RATE_LIMIT_REDIS_URL` missing | Rate limiter falls back to in-memory (documented) |
| `STRIPE_SECRET_KEY` missing | Payment endpoints return 503 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` missing | Push notifications disabled; warning logged |
| `SOROBAN_CONTRACT_ADDRESS` missing | Blockchain sync disabled; subscriptions work DB-only |
