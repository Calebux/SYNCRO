# Self-Hosted Deployment Runbook

This runbook covers deploying SYNCRO on infrastructure you control: sizing, Docker Compose, environment configuration, Supabase, Stellar connectivity, backups, monitoring, and troubleshooting.

For local development setup, see [CONTRIBUTING.md](../CONTRIBUTING.md). For the environment-variable strategy and CI validation model, see [ENVIRONMENT.md](./ENVIRONMENT.md).

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Infrastructure requirements](#infrastructure-requirements)
3. [Pre-deployment checklist](#pre-deployment-checklist)
4. [Docker Compose setup](#docker-compose-setup)
5. [Environment variable reference](#environment-variable-reference)
6. [Supabase self-hosted configuration](#supabase-self-hosted-configuration)
7. [Stellar node connection setup](#stellar-node-connection-setup)
8. [Backup and restore procedures](#backup-and-restore-procedures)
9. [Monitoring and alerting](#monitoring-and-alerting)
10. [Ongoing maintenance](#ongoing-maintenance)
11. [Troubleshooting FAQ](#troubleshooting-faq)
12. [Related documentation](#related-documentation)

---

## Architecture overview

SYNCRO is a monorepo with four runtime components you deploy:

| Component | Package | Default port | Purpose |
|-----------|---------|--------------|---------|
| **Client** | `client/` | 3000 | Next.js web app (UI + server-side API routes) |
| **Backend** | `backend/` | 3001 | Express API, background jobs, blockchain indexer |
| **Database / Auth** | `supabase/` | 54321 (API), 54322 (Postgres) | PostgreSQL, Supabase Auth, Storage, RLS |
| **Redis** | external | 6379 | Rate limiting, job queues, renewal locks (strongly recommended in production) |

External dependencies (not self-hosted by SYNCRO, but required for full functionality):

- **SMTP** — reminder and notification email
- **Stellar Soroban RPC** — on-chain subscription logging and event indexing
- **Payment providers** — Stripe, Paystack, PayPal (optional, feature-dependent)
- **OAuth providers** — Google (Gmail), Microsoft (Outlook) (optional)

```mermaid
flowchart TB
  subgraph users [Users]
    Browser[Browser / PWA]
  end

  subgraph syncro [SYNCRO stack]
    Client[Client :3000]
    Backend[Backend :3001]
    Redis[(Redis :6379)]
  end

  subgraph data [Data layer]
    Supabase[Supabase / PostgreSQL]
  end

  subgraph external [External services]
    SMTP[SMTP]
    Stellar[Soroban RPC]
    Stripe[Stripe / Paystack]
  end

  Browser --> Client
  Client --> Backend
  Client --> Supabase
  Backend --> Supabase
  Backend --> Redis
  Backend --> SMTP
  Backend --> Stellar
  Client --> Stripe
```

**Startup order:** Supabase (database) → Redis → Backend → Client.

---

## Infrastructure requirements

### Minimum (development / small pilot)

Suitable for a single-team pilot or staging environment with fewer than ~100 active users.

| Resource | Specification |
|----------|---------------|
| **CPU** | 4 vCPU |
| **Memory** | 8 GB RAM |
| **Storage** | 50 GB SSD (OS + Docker images + Postgres data) |
| **Network** | 100 Mbps, static IP or stable DNS |
| **OS** | Linux (Ubuntu 22.04+ or Debian 12+ recommended) |

Services on one host:

- Supabase stack (Postgres, Auth, Kong, Studio)
- Redis
- Backend (1 instance)
- Client (1 instance)

### Recommended (production)

Suitable for production workloads with background jobs, rate limiting, and headroom for traffic spikes.

| Resource | Specification |
|----------|---------------|
| **CPU** | 8+ vCPU |
| **Memory** | 16–32 GB RAM |
| **Storage** | 200+ GB SSD; separate volume for Postgres data |
| **Network** | 1 Gbps; TLS termination at reverse proxy or load balancer |
| **High availability** | Managed Postgres or Supabase with automated backups; Redis with persistence (AOF/RDB) |

Suggested layout:

| Tier | Components |
|------|------------|
| **App** | 2+ backend replicas behind a load balancer; 2+ client replicas or CDN-backed static export |
| **Data** | Dedicated Postgres (Supabase self-hosted or managed); Redis Sentinel or managed Redis |
| **Edge** | Reverse proxy (nginx, Caddy, Traefik) with TLS, rate limiting, and WAF |

### Software prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 20+ | Build and run backend/client |
| **npm** | 10+ | Workspace installs from repo root |
| **Docker** | 24+ | Required for Supabase and the Compose stack below |
| **Docker Compose** | v2+ | Orchestrate SYNCRO services |
| **Supabase CLI** | latest | Migrations, `db push`, backup helpers |
| **Stellar CLI** | v21+ | Contract deployment only (see [contracts/DEPLOYMENT.md](../contracts/DEPLOYMENT.md)) |

---

## Pre-deployment checklist

Complete these steps before pointing production traffic at the stack.

- [ ] Clone the repository and check out a tagged release (not `main` unless you accept bleeding-edge risk).
- [ ] Provision host(s) meeting [recommended specs](#recommended-production).
- [ ] Configure DNS: `app.example.com` (client), `api.example.com` (backend).
- [ ] Obtain TLS certificates (Let's Encrypt or your CA).
- [ ] Deploy Supabase (self-hosted or managed) and note URL + keys.
- [ ] Apply migrations: `supabase db push --db-url "$DATABASE_URL"`.
- [ ] Deploy Soroban contracts (if using blockchain features) — [contracts/DEPLOYMENT.md](../contracts/DEPLOYMENT.md).
- [ ] Copy and fill `backend/.env` and `client/.env.local` from templates.
- [ ] Generate secrets: `openssl rand -hex 32` for `JWT_SECRET`, `ADMIN_API_KEY`, `ENCRYPTION_KEY`.
- [ ] Set production blockchain flags — [blockchain-feature-flags.md](./blockchain-feature-flags.md).
- [ ] Validate environment:
  ```bash
  node scripts/check-env-docs.js
  node backend/scripts/validate-env.js
  node client/scripts/validate-env.js
  ```
- [ ] Build packages:
  ```bash
  npm install --legacy-peer-deps --ignore-scripts
  npm run build -w shared
  npm run build -w backend
  npm run build -w client
  ```
- [ ] Configure reverse proxy and health checks (`/health/ready` on backend).
- [ ] Configure backups (Postgres daily; test a restore).
- [ ] Configure monitoring (Sentry, uptime checks, log aggregation).
- [ ] Run post-deploy smoke tests — [SMOKE_TESTS.md](./SMOKE_TESTS.md).

---

## Docker Compose setup

SYNCRO does not ship production Dockerfiles in-repo; the examples below are the reference layout for self-hosted deployments. Adjust image names, domains, and secrets for your environment.

### Directory layout

Create a deployment directory adjacent to your clone (or mount the repo as a build context):

```
syncro-deploy/
├── docker-compose.yml
├── .env                    # Compose-level vars (not committed)
├── backend/
│   └── Dockerfile
├── client/
│   └── Dockerfile
└── Caddyfile               # or nginx.conf — TLS termination
```

### Backend Dockerfile

```dockerfile
# backend/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY client/package.json client/
COPY sdk/package.json sdk/
COPY shared/package.json shared/
RUN npm ci --legacy-peer-deps --ignore-scripts
COPY shared/ shared/
COPY backend/ backend/
RUN npm run build -w shared && npm run build -w backend

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/deploy/manifests ./deploy/manifests
EXPOSE 3001
CMD ["node", "backend/dist/index.js"]
```

### Client Dockerfile

```dockerfile
# client/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_STELLAR_NETWORK
ARG NEXT_PUBLIC_SOROBAN_RPC_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_STELLAR_NETWORK=$NEXT_PUBLIC_STELLAR_NETWORK \
    NEXT_PUBLIC_SOROBAN_RPC_URL=$NEXT_PUBLIC_SOROBAN_RPC_URL
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY client/package.json client/
COPY sdk/package.json sdk/
COPY shared/package.json shared/
RUN npm ci --legacy-peer-deps --ignore-scripts
COPY shared/ shared/
COPY client/ client/
RUN npm run build -w shared && npm run build -w client

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/client/.next ./client/.next
COPY --from=builder /app/client/public ./client/public
COPY --from=builder /app/client/package.json ./client/
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "client"]
```

> **Note:** `NEXT_PUBLIC_*` variables are baked in at **build time**. Rebuild the client image whenever these values change.

### docker-compose.yml (SYNCRO services + Redis)

This Compose file covers SYNCRO application services and Redis. Supabase is deployed separately (see [Supabase self-hosted configuration](#supabase-self-hosted-configuration)).

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

  backend:
    build:
      context: ..
      dockerfile: syncro-deploy/backend/Dockerfile
    restart: unless-stopped
    env_file:
      - ../backend/.env
    environment:
      REDIS_URL: redis://redis:6379
      RATE_LIMIT_REDIS_URL: redis://redis:6379
      RATE_LIMIT_REDIS_ENABLED: "true"
    ports:
      - "3001:3001"
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health/ready"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 45s

  client:
    build:
      context: ..
      dockerfile: syncro-deploy/client/Dockerfile
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
        NEXT_PUBLIC_STELLAR_NETWORK: ${NEXT_PUBLIC_STELLAR_NETWORK:-mainnet}
        NEXT_PUBLIC_SOROBAN_RPC_URL: ${NEXT_PUBLIC_SOROBAN_RPC_URL}
    restart: unless-stopped
    env_file:
      - ../client/.env.local
    ports:
      - "3000:3000"
    depends_on:
      backend:
        condition: service_healthy

volumes:
  redis_data:
```

### Deploy commands

```bash
# 1. Ensure Supabase is running and migrations are applied (see below)

# 2. Configure env files
cp backend/.env.example backend/.env
cp client/.env.example client/.env.local
# Edit both files with production values

# 3. Export client build args for Compose
export NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com
export NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
export NEXT_PUBLIC_API_URL=https://api.example.com
export NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
export NEXT_PUBLIC_STELLAR_NETWORK=mainnet
export NEXT_PUBLIC_SOROBAN_RPC_URL=https://your-mainnet-rpc.example.com

# 4. Build and start
docker compose up -d --build

# 5. Verify
curl -sf https://api.example.com/health/ready | jq .
curl -sf https://app.example.com/api/health
```

### Reverse proxy (TLS)

Terminate TLS at Caddy, nginx, or Traefik. Route:

| Host | Upstream |
|------|----------|
| `app.example.com` | `client:3000` |
| `api.example.com` | `backend:3001` |

Use `/health/ready` (backend) for load-balancer health checks — details in [backend/docs/DEPLOYMENT_PROBES.md](../backend/docs/DEPLOYMENT_PROBES.md).

---

## Environment variable reference

Canonical variable **names** live in:

- `backend/scripts/env.manifest.js`
- `client/scripts/env.manifest.js`

Templates: `backend/.env.example`, `client/.env.example`.

Run validators before every deploy:

```bash
node backend/scripts/validate-env.js
node client/scripts/validate-env.js
```

### Backend — required

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project API URL (e.g. `https://supabase.example.com` or `http://127.0.0.1:54321` locally). |
| `SUPABASE_ANON_KEY` | Supabase anonymous (public) API key. Used for RLS-scoped client operations from the backend when needed. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key. **Bypasses RLS** — server-only; never expose to the browser. |
| `JWT_SECRET` | Secret for signing backend-issued JWTs. Generate with `openssl rand -hex 32`. |
| `ADMIN_API_KEY` | Protects `/api/admin/*` and sensitive ops (e.g. risk recalculation). Generate with `openssl rand -hex 32`. |
| `SMTP_HOST` | Outbound mail server hostname. |
| `SMTP_PORT` | SMTP port (typically `587` for STARTTLS). |
| `SMTP_USER` | SMTP authentication username. |
| `SMTP_PASS` | SMTP authentication password or app-specific password. |
| `STELLAR_NETWORK_URL` | Stellar/Soroban RPC endpoint URL. Required at boot; used by the event listener. |
| `SOROBAN_CONTRACT_ADDRESS` | Primary Soroban contract ID for the event indexer. Set after contract deployment. |

### Backend — server (optional, have defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Set to `production` in production. Enables blockchain safety checks. |
| `PORT` | `3001` | HTTP listen port. |
| `FRONTEND_URL` | `http://localhost:3000` | Allowed CORS origin and redirect base for emails/links. |
| `LOG_LEVEL` | `info` | Winston log level (`error`, `warn`, `info`, `debug`). |
| `JWT_EXPIRES_IN` | `7d` | JWT token lifetime. |

### Backend — Stellar / Soroban

| Variable | Description |
|----------|-------------|
| `STELLAR_NETWORK` | Active network: `testnet`, `mainnet`, or `futurenet`. **Must be `mainnet` in production.** |
| `SOROBAN_RPC_URL` | Soroban RPC URL. **Required explicitly in production** (no testnet fallback). |
| `STELLAR_SECRET_KEY` | Secret key (`S...`) for signing on-chain transactions. Optional if blockchain writes are disabled. |
| `STELLAR_NETWORK_PASSPHRASE` | Network passphrase. Mainnet: `Public Global Stellar Network ; September 2015`. |
| `ENABLE_BLOCKCHAIN` | Master switch for on-chain writes. Set `false` to use database-only logging. Default: `true`. |
| `ENABLE_TESTNET_ACTIONS` | Allow faucet/testnet-only actions. **Must be `false` in production.** |
| `INDEXER_POLL_INTERVAL_MS` | Event indexer poll interval (default `5000`). |
| `INDEXER_BATCH_SIZE` | Events per indexer batch (default `100`). |
| `AGENT_MASTER_SEED` | BIP-39 mnemonic for pipeline agent HD wallets. Required when `ENABLE_BLOCKCHAIN=true`. |
| `AGENT_ROTATION_SCHEDULE` | Agent address rotation: `per-task`, `daily`, `weekly`, `manual`. |

Production blockchain checklist: [blockchain-feature-flags.md](./blockchain-feature-flags.md).

Deployment manifests at `deploy/manifests/<network>.json` can populate `SOROBAN_CONTRACT_ADDRESS`, `SOROBAN_RPC_URL`, and `STELLAR_NETWORK_URL` when those env vars are unset.

### Backend — integrations (optional)

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API secret key. Payments disabled if unset. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret. |
| `PAYSTACK_SECRET_KEY` | Paystack secret key (NG, GH, ZA, KE markets). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Gmail OAuth integration. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` / `MICROSOFT_REDIRECT_URI` | Outlook OAuth integration. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot for notifications/commands. |
| `TELEGRAM_WEBHOOK_SECRET` | Secret token for Telegram webhook verification. |
| `SLACK_WEBHOOK_URL` | Incoming webhook for operational alerts. |
| `ENCRYPTION_KEY` | 32-byte key for encrypting stored third-party tokens. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push notification keys. |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | AI fallback for email subscription classification. |

### Backend — Redis / rate limiting

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Primary Redis connection URL. Used by renewal locks, DLQ, and queues. |
| `RATE_LIMIT_REDIS_URL` | Redis URL for rate limiter (can match `REDIS_URL`). |
| `RATE_LIMIT_REDIS_ENABLED` | Enable Redis-backed rate limiting (`true` recommended in production). |
| `RATE_LIMIT_*` | Per-endpoint rate limit tuning (team invites, MFA, admin, stealth addresses, etc.). See `backend/.env.example`. |

### Backend — monitoring

| Variable | Description |
|----------|-------------|
| `SENTRY_DSN` | Sentry project DSN for error tracking. |
| `SENTRY_RELEASE` | Release identifier (e.g. `syncro@1.0.0+abc1234`). |
| `SENTRY_ENVIRONMENT` | Sentry environment tag (e.g. `production`, `staging`). |
| `COMMIT_SHA` | Git SHA for release tagging when `SENTRY_RELEASE` is unset. |
| `CSP_MONITORING_ENABLED` | Enable CSP violation monitoring jobs. |
| `CSP_ALERT_HOURLY_RATE` | Alert threshold: violations per hour per type. |
| `CSP_ALERT_AFFECTED_USERS` | Alert threshold: unique users affected. |

### Client — required

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL (browser-safe). Must match backend `SUPABASE_URL`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser-safe; protected by RLS). |
| `NEXT_PUBLIC_API_URL` | Backend API base URL (e.g. `https://api.example.com`). |
| `STRIPE_SECRET_KEY` | Server-only Stripe key for `client/app/api/*` payment routes. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Browser Stripe.js publishable key. |

### Client — optional

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | Public app URL for redirects and metadata. |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Browser-visible Stellar network (`mainnet` in production). |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Browser-visible Soroban RPC URL. |
| `NEXT_PUBLIC_SENTRY_DSN` | Client-side Sentry DSN. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; used by Next.js API routes that need elevated access. |
| `MAINTENANCE_MODE` | When `true`, serve maintenance page. |
| `PAYPAL_*` / `PAYSTACK_SECRET_KEY` | Additional payment provider config for client API routes. |

> **Security:** Never prefix secrets with `NEXT_PUBLIC_`. The service role key and `ADMIN_API_KEY` must never reach the browser bundle.

---

## Supabase self-hosted configuration

SYNCRO stores all application data in PostgreSQL via Supabase (Auth, RLS, Storage). Migrations live in `supabase/migrations/`.

### Option A — Supabase CLI (local / single-node)

Best for development and small single-server deployments where the Supabase CLI manages Docker containers.

```bash
# Install CLI: https://supabase.com/docs/guides/cli
supabase start

# Apply all migrations + seed
supabase db reset          # dev only — destroys data
# OR for production-safe apply:
supabase db push --db-url "postgresql://postgres:PASSWORD@db.example.com:5432/postgres"

# Print connection details and keys
supabase status
```

Default local ports (from `supabase/config.toml`):

| Service | Port |
|---------|------|
| API (Kong) | 54321 |
| Postgres | 54322 |
| Studio | 54323 |
| Inbucket (mail catcher) | 54324 |

Copy keys from `supabase status` into `backend/.env` and `client/.env.local`.

### Option B — Official Supabase Docker (production self-host)

For production, use the [official Supabase self-hosting guide](https://supabase.com/docs/guides/self-hosting/docker):

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
# Edit .env: POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, etc.
docker compose up -d
```

After the stack is healthy:

1. **Point `SUPABASE_URL`** at your Kong/API gateway (e.g. `https://supabase.example.com`).
2. **Set keys** from the Supabase `.env` file (`ANON_KEY`, `SERVICE_ROLE_KEY`).
3. **Apply SYNCRO migrations** from this repository:

   ```bash
   cd /path/to/SYNCRO
   supabase link --project-ref local   # or use --db-url directly
   supabase db push --db-url "postgresql://postgres:YOUR_PASSWORD@db:5432/postgres"
   ```

4. **Configure Auth** in Supabase Dashboard / `config.toml`:
   - `site_url` → your client URL (e.g. `https://app.example.com`)
   - `additional_redirect_urls` → OAuth callback URLs
   - Enable email provider or connect external SMTP for auth emails

5. **Run RLS audit** after migrations:

   ```bash
   npm run audit:rls -w backend
   ```

### Supabase settings for SYNCRO

| Setting | Value |
|---------|-------|
| Postgres major version | 15 (matches `supabase/config.toml`) |
| Schemas exposed via API | `public`, `graphql_public` |
| Auth JWT expiry | Default 3600s; align with `JWT_EXPIRES_IN` strategy |
| Storage file size limit | 50 MiB (default in config) |

### Migration management

```bash
# Create a new migration (development)
npm run db:new -w backend

# Check for migration drift before deploy
npm run check:migrations

# Production push
npm run db:migrate:prod -w backend   # uses PRODUCTION_DB_URL
```

Do **not** run `supabase db reset` against production. Always take a backup before `db push`.

---

## Stellar node connection setup

SYNCRO does **not** require a self-hosted Stellar Core node. It connects to a **Soroban RPC endpoint** for contract invocation and event indexing. You can use a public RPC provider or operate your own.

### Testnet (staging)

```bash
# backend/.env
STELLAR_NETWORK=testnet
STELLAR_NETWORK_URL=https://soroban-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
ENABLE_TESTNET_ACTIONS=true
SOROBAN_CONTRACT_ADDRESS=<deployed_contract_id>
```

Deploy contracts:

```bash
cd contracts
stellar keys generate --global deployer --network testnet --fund
export STELLAR_SECRET_KEY=$(stellar keys show deployer)
bash scripts/deploy.sh testnet
# Copy printed addresses into backend/.env
```

### Mainnet (production)

```bash
# backend/.env
STELLAR_NETWORK=mainnet
STELLAR_NETWORK_URL=https://your-mainnet-rpc.example.com
SOROBAN_RPC_URL=https://your-mainnet-rpc.example.com
STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
ENABLE_TESTNET_ACTIONS=false
ENABLE_BLOCKCHAIN=true
SOROBAN_CONTRACT_ADDRESS=<mainnet_contract_id>
STELLAR_SECRET_KEY=S...   # funded account for signing
AGENT_MASTER_SEED="your 24-word mnemonic"   # when ENABLE_BLOCKCHAIN=true
```

```bash
# client/.env.local (baked at build time)
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://your-mainnet-rpc.example.com
```

The backend **refuses to start** in production if:

- RPC URL contains `testnet` or `futurenet`
- `STELLAR_NETWORK` is not `mainnet`
- `ENABLE_TESTNET_ACTIONS=true`
- Passphrase contains `test`

See [blockchain-feature-flags.md](./blockchain-feature-flags.md) for the full checklist.

### RPC provider options

| Option | Notes |
|--------|-------|
| **Public Stellar RPC** | Testnet: `https://soroban-testnet.stellar.org`. Mainnet: use a reputable provider (e.g. [Creit Tech](https://soroban-rpc.creit.tech)) or Stellar Foundation endpoints. |
| **Self-hosted Soroban RPC** | Run [soroban-rpc](https://github.com/stellar/soroban-rpc) against your own Stellar Core with Soroban enabled. Requires operational Stellar Core expertise. |
| **Disable blockchain** | Set `ENABLE_BLOCKCHAIN=false` to run database-only mode without a healthy RPC. Event listener and indexer will be disabled. |

### Verify connectivity

```bash
# Backend health includes provider checks
curl -s http://localhost:3001/health/ready | jq '.dependencies[] | select(.name=="providers")'

# Confirm indexer started (backend logs on boot)
docker compose logs backend | grep -i eventlistener
```

### Deployment manifest

After contract deployment, write `deploy/manifests/mainnet.json`:

```json
{
  "network": "mainnet",
  "sorobanContractAddress": "C...",
  "sorobanRpcUrl": "https://your-mainnet-rpc.example.com",
  "stellarNetworkUrl": "https://your-mainnet-rpc.example.com",
  "deployedAt": "2026-06-29T00:00:00Z",
  "commitSha": "abc1234"
}
```

The backend loads this at startup when env vars are unset ([`backend/src/utils/manifest.ts`](../backend/src/utils/manifest.ts)).

---

## Backup and restore procedures

### What to back up

| Asset | Priority | Method |
|-------|----------|--------|
| **PostgreSQL (Supabase)** | Critical | `pg_dump` or Supabase CLI |
| **Redis** | Medium | RDB/AOF snapshots (rate-limit state is ephemeral; DLQ may matter) |
| **Environment secrets** | Critical | Secret manager (Vault, AWS SM) — not only on disk |
| **Supabase Storage** | Medium | Bucket replication or periodic sync |
| **Deployment manifests** | Low | Git-tracked in `deploy/manifests/` |

### PostgreSQL backup (daily)

**Using Supabase CLI:**

```bash
supabase db dump --db-url "$DATABASE_URL" -f "backup-$(date +%Y%m%d).sql"
```

**Using pg_dump directly:**

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file="syncro-backup-$(date +%Y%m%d).dump"
```

Automate with cron (run on a host with network access to Postgres):

```cron
0 2 * * * pg_dump "$DATABASE_URL" --format=custom --file=/backups/syncro-$(date +\%Y\%m\%d).dump
```

Retention recommendation: 30 daily, 12 monthly.

Encrypt backups at rest (`gpg`, S3 SSE, or your backup tool's encryption).

### PostgreSQL restore

**Full restore (destructive — overwrites current data):**

```bash
# Stop backend to prevent writes
docker compose stop backend client

# Restore
pg_restore --clean --if-exists --dbname="$DATABASE_URL" syncro-backup-20260629.dump

# Restart and verify
docker compose start backend client
curl -sf http://localhost:3001/health/ready
```

**Point-in-time recovery:** Use your Postgres provider's PITR (managed Supabase, RDS, etc.) if available.

### Redis backup

With AOF enabled (as in the Compose example):

```bash
docker compose exec redis redis-cli BGSAVE
docker cp syncro-deploy-redis-1:/data/dump.rdb ./redis-backup-$(date +%Y%m%d).rdb
```

Restore: stop Redis, replace `dump.rdb`, restart.

### Backup verification

Monthly, restore to an isolated environment and run:

```bash
npm run test:smoke -w backend
```

See [SMOKE_TESTS.md](./SMOKE_TESTS.md) for smoke test setup.

---

## Monitoring and alerting

### Health endpoints

| Endpoint | Use | Expected |
|----------|-----|----------|
| `GET /health/live` | Liveness — process alive | HTTP 200 always |
| `GET /health/ready` | Readiness — accept traffic | HTTP 200 when DB healthy; 503 when not |
| `GET /health` | Legacy | HTTP 200 (deprecated) |
| `GET /api/health` (client) | Frontend health | HTTP 200 |

Readiness checks: database (critical), Redis (unhealthy only if configured but unreachable), queue, providers, scheduler. Details: [backend/docs/DEPLOYMENT_PROBES.md](../backend/docs/DEPLOYMENT_PROBES.md).

### Recommended alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| Backend not ready | `/health/ready` returns 503 for > 5 min | Critical |
| Backend down | `/health/live` fails for > 2 min | Critical |
| Slow health check | `/health/ready` latency > 2s sustained | Warning |
| Database unhealthy | `dependencies[].name=="database"` status `unhealthy` | Critical |
| Redis unhealthy | Redis configured but ping fails | Warning |
| Scheduler degraded | Scheduler not running or 0 jobs | Warning |
| High error rate | Sentry alert: > N errors/min | Warning–Critical |
| CSP violation spike | `CSP_ALERT_HOURLY_RATE` exceeded | Warning |
| Disk space | Postgres volume > 85% | Warning |

### Sentry

Set on both backend and client:

```bash
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=syncro@1.0.0+$(git rev-parse --short HEAD)
COMMIT_SHA=$(git rev-parse HEAD)
```

### Uptime monitoring

Configure an external uptime checker (UptimeRobot, Pingdom, Better Stack) against:

- `https://api.example.com/health/ready`
- `https://app.example.com/api/health`

### Log aggregation

Backend uses Winston with daily rotate. In Docker, ship stdout/stderr to your log stack (Loki, CloudWatch, Datadog):

```bash
docker compose logs -f backend
```

Set `LOG_LEVEL=warn` in production unless actively debugging.

### Slack operational notifications

Set `SLACK_WEBHOOK_URL` in `backend/.env` for job alerts and operational notifications.

### Post-deploy smoke tests

After every deploy:

```bash
cd backend
npm run setup:smoke-user    # once per environment
npm run test:smoke
```

Or trigger the CI workflow described in [SMOKE_TESTS.md](./SMOKE_TESTS.md).

---

## Ongoing maintenance

| Task | Frequency | Reference |
|------|-----------|-----------|
| Apply dependency updates | Weekly review | Dependabot / `npm audit` |
| Rotate secrets | 90–180 days | [SECRET_ROTATION_POLICY.md](./SECRET_ROTATION_POLICY.md) |
| Postgres backups + restore test | Daily backup; monthly restore drill | [Backup section](#backup-and-restore-procedures) |
| RLS audit | After schema changes | [RLS_AUDIT_GUIDE.md](./RLS_AUDIT_GUIDE.md) |
| Migration drift check | Before each deploy | `npm run check:migrations` |
| SSL certificate renewal | Auto (Let's Encrypt) | Reverse proxy config |
| Review Sentry / CSP alerts | Daily | Sentry dashboard |
| Contract address updates | On upgrade | [contracts/DEPLOYMENT.md](../contracts/DEPLOYMENT.md) |

### Upgrades

1. Take a Postgres backup.
2. Pull the new release tag.
3. Run `supabase db push` if migrations changed.
4. Rebuild Docker images (client rebuild required if `NEXT_PUBLIC_*` changed).
5. Rolling restart: backend first, then client.
6. Run smoke tests.
7. Monitor `/health/ready` and Sentry for 30 minutes.

---

## Troubleshooting FAQ

### Backend exits immediately on start with "Environment validation failed"

**Cause:** Missing required env vars.

**Fix:**

```bash
node backend/scripts/validate-env.js
```

Compare output against [Backend — required](#backend--required). Common misses: `ADMIN_API_KEY`, `SMTP_*`, `STELLAR_NETWORK_URL`, `SOROBAN_CONTRACT_ADDRESS`.

---

### Backend crashes in production with blockchain safety check errors

**Cause:** Testnet URLs or flags in a production environment.

**Fix:** Set `NODE_ENV=production`, `STELLAR_NETWORK=mainnet`, mainnet RPC URLs, mainnet passphrase, and `ENABLE_TESTNET_ACTIONS=false`. See [blockchain-feature-flags.md](./blockchain-feature-flags.md).

---

### `/health/ready` returns 503 — database unhealthy

**Cause:** Supabase/Postgres unreachable, wrong credentials, or migrations not applied.

**Fix:**

1. Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. Test Postgres connectivity: `psql "$DATABASE_URL" -c 'SELECT 1'`.
3. Apply migrations: `supabase db push --db-url "$DATABASE_URL"`.
4. Check Supabase/Kong logs: `docker compose logs` in the Supabase directory.

---

### `/health/ready` returns 503 — redis unhealthy

**Cause:** `REDIS_URL` is set but Redis is down or unreachable.

**Fix:**

1. Confirm Redis is running: `docker compose ps redis`.
2. Test: `redis-cli -u "$REDIS_URL" ping` → `PONG`.
3. If Redis is intentionally unavailable, remove `REDIS_URL` (degraded mode — not recommended for production).

---

### Client shows "failed to fetch" or API errors

**Cause:** `NEXT_PUBLIC_API_URL` misconfigured or CORS blocked.

**Fix:**

1. Ensure `NEXT_PUBLIC_API_URL` matches the public backend URL (including `https://`).
2. Rebuild the client image — `NEXT_PUBLIC_*` vars are build-time only.
3. Set `FRONTEND_URL` on the backend to your client origin.
4. Verify: `curl -sf "$NEXT_PUBLIC_API_URL/health/live"`.

---

### Emails (reminders, auth) not sending

**Cause:** SMTP misconfiguration or Supabase auth email not configured.

**Fix:**

1. Verify `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` with an SMTP test tool.
2. For Supabase Auth emails, configure SMTP in Supabase Dashboard → Project Settings → Auth.
3. Check backend logs for Nodemailer errors.

---

### Blockchain indexer / EventListener disabled

**Cause:** Missing `SOROBAN_CONTRACT_ADDRESS` or `STELLAR_NETWORK_URL`.

**Fix:**

1. Deploy contracts: [contracts/DEPLOYMENT.md](../contracts/DEPLOYMENT.md).
2. Set `SOROBAN_CONTRACT_ADDRESS` and RPC URLs.
3. Or set `ENABLE_BLOCKCHAIN=false` to run without on-chain features.
4. Restart backend and check logs for `EventListener started`.

---

### Migrations fail or schema drift detected

**Cause:** Out-of-order migrations, duplicate files, or manual schema edits.

**Fix:**

```bash
npm run check:migrations
npm run check:migrations:verify-db -w backend
```

Resolve conflicts in `supabase/migrations/` before pushing. Never edit applied migration files — create a new migration instead.

---

### Stripe / payment webhooks failing

**Cause:** Webhook URL not reachable or wrong signing secret.

**Fix:**

1. Stripe webhook URL: `https://app.example.com/api/webhooks/stripe` (client route).
2. Match `STRIPE_WEBHOOK_SECRET` in both client and backend env if both verify webhooks.
3. Use Stripe CLI for local testing: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

---

### High memory usage on backend

**Cause:** Background jobs, indexer batch size, or risk calculation concurrency.

**Fix:**

1. Lower `RISK_CALC_CONCURRENCY` (default `10`).
2. Lower `INDEXER_BATCH_SIZE`.
3. Scale horizontally (multiple backend replicas + shared Redis/Postgres).
4. Profile with `LOG_LEVEL=debug` temporarily.

---

### OAuth (Gmail / Outlook) redirect errors

**Cause:** Redirect URI mismatch with provider console.

**Fix:**

1. `GOOGLE_REDIRECT_URI` must exactly match Google Cloud Console authorized redirect URI: `https://api.example.com/api/integrations/gmail/callback`.
2. Same pattern for Microsoft: `https://api.example.com/api/integrations/outlook/callback`.
3. Add URLs to Supabase Auth redirect allow list if using Supabase OAuth.

---

## Related documentation

| Document | Topic |
|----------|-------|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Local development quick start |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | Env var strategy and CI validation |
| [blockchain-feature-flags.md](./blockchain-feature-flags.md) | Production blockchain safety |
| [contracts/DEPLOYMENT.md](../contracts/DEPLOYMENT.md) | Soroban contract deployment |
| [backend/docs/DEPLOYMENT_PROBES.md](../backend/docs/DEPLOYMENT_PROBES.md) | Health probe details |
| [SMOKE_TESTS.md](./SMOKE_TESTS.md) | Post-deploy verification |
| [SECRET_ROTATION_POLICY.md](./SECRET_ROTATION_POLICY.md) | Secret rotation schedule |
| [RLS_AUDIT_GUIDE.md](./RLS_AUDIT_GUIDE.md) | Row-level security audit |
| [deploy/manifests/README.md](../deploy/manifests/README.md) | Deployment manifest format |
