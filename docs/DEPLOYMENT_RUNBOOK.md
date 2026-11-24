# Self-Hosted Deployment Runbook

This runbook covers deploying SYNCRO on infrastructure you control: sizing, Docker Compose, environment configuration, Supabase, Stellar connectivity, backups, monitoring, and troubleshooting.

v3 adds two processes the old client/API deploy does not have: a **settlement engine** that holds the key that signs channel states, and an **indexer** that stores how far it has read the chain. Those two change which environment may talk to which network, the order you start things, and how you roll back. Follow [v3 environments, deploy order, and rollback](#v3-environments-deploy-order-and-rollback) for any deploy that moves value. The later sections (Compose, env vars, Supabase, probes) still apply to the client and the API.

For local development setup, see [CONTRIBUTING.md](../CONTRIBUTING.md). For the environment-variable strategy and CI validation model, see [ENVIRONMENT.md](./ENVIRONMENT.md). Custody of the settlement key is in [KEY_ROTATION_FLOW.md](../KEY_ROTATION_FLOW.md).

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [v3 environments, deploy order, and rollback](#v3-environments-deploy-order-and-rollback)
3. [Infrastructure requirements](#infrastructure-requirements)
4. [Pre-deployment checklist](#pre-deployment-checklist)
5. [Docker Compose setup](#docker-compose-setup)
6. [Environment variable reference](#environment-variable-reference)
7. [Supabase self-hosted configuration](#supabase-self-hosted-configuration)
8. [Stellar node connection setup](#stellar-node-connection-setup)
9. [Backup and restore procedures](#backup-and-restore-procedures)
10. [Monitoring and alerting](#monitoring-and-alerting)
11. [Ongoing maintenance](#ongoing-maintenance)
12. [Troubleshooting FAQ](#troubleshooting-faq)
13. [Related documentation](#related-documentation)

---

## Architecture overview

SYNCRO is a monorepo. v3 splits the path that admits a paid call from the path that signs channel state and from the path that reads the chain.

| Component | Where it lives | Scales? | Holds a key that can move value? |
|-----------|----------------|---------|----------------------------------|
| **Client** | `client/` :3000 | Yes | No |
| **Gateway** | `backend/` :3001 (`backend/src/routes`, `backend/src/v3`) | Yes, as stateless API replicas | No. It admits calls. It does not sign channel states. |
| **Meter** | `quota_guard/`, called by the gateway | With the gateway | No |
| **Indexer** | `backend/src/blockchain/indexer.ts` | One active reader per database | No. It only reads Soroban RPC and writes Postgres. |
| **Settlement engine** | `packages/settlement`, `backend/src/services`, settlement jobs in `backend/src/jobs` | **One process per environment** | **Yes.** This is the only runtime that may hold the channel-state signing key. |
| **Database** | `supabase/` Postgres | Managed | No private keys. It does store the nonce high-water mark (`channel_signer_lease`) and the indexer cursor (`event_cursor`). |
| **Redis** | external :6379 | Sentinel or managed | No |

On-chain contracts the gateway and the engine name by address: agent registry (scope), payment channel (state), spend caps, and escrow (disputes). Addresses come from the deploy manifest after contract deployment, not from the application image.

```mermaid
flowchart TB
  Agent[Consumer agent] --> Gateway[Gateway]
  Browser[Console] --> Gateway
  Gateway --> Meter[Meter]
  Gateway --> Registry[Registry and cap contracts]
  Meter --> Engine[Settlement engine]
  Indexer[Indexer] --> Engine
  Engine --> KMS[KMS or HSM signer]
  Engine --> Channel[Channel contract]
  Indexer --> RPC[Soroban RPC]
  Channel --> RPC
  RPC --> Indexer
  Gateway --> DB[(Postgres)]
  Indexer --> DB
  Engine --> DB
```

The settlement engine reads closed meter windows, signs the next channel state, submits when its policy says to touch the chain, and reconciles what the indexer has stored. It does not admit calls or price routes. The gateway does not get the signing key. The indexer does not get it either.

**Deploy order** is in the next section: database, contracts, gateway configuration, indexer caught up, one settlement engine, then gateway traffic, then the client. The gateway stays dark until contract addresses are loaded, and the engine stays dark until the indexer has caught up.

---

## v3 environments, deploy order, and rollback

Use this section to stand up an environment and to undo a bad application release. Contract upgrades are a separate procedure: [contract-upgrade-runbook.md](./ops/contract-upgrade-runbook.md).

### Environments and what they connect to

Each environment has its own database, its own indexer cursor, and its own settlement key. A process in one environment must not be given another environment's RPC, contract addresses, or key handle.

| | Local | CI / test | Staging | Production |
|---|---|---|---|---|
| **Stellar network** | `testnet`, or `ENABLE_BLOCKCHAIN=false` | `testnet` | `testnet` | `mainnet` only. The process refuses to boot if the RPC URL, network name, or passphrase looks like testnet. |
| **Contracts** | `deploy/manifests/testnet.json` after `contracts/scripts/deploy.sh testnet` | Fixture addresses, never mainnet | Staging testnet manifest. Reject the deploy if any address is a mainnet contract. | `deploy/manifests/mainnet.json` written at contract deploy time |
| **Gateway** | Local API against the local database and the testnet manifest | Ephemeral API, discarded with the job | Staging API, staging database, testnet RPC, staging contract IDs | Production API, production database, mainnet RPC, mainnet contract IDs |
| **Indexer** | Local Postgres `event_cursor`, testnet RPC, `SOROBAN_CONTRACT_ADDRESS` from the testnet manifest | Ephemeral database and cursor | Staging database and cursor, testnet RPC, same contract id the gateway uses | Production database and cursor, mainnet RPC, same contract id the gateway uses |
| **Settlement engine** | One process. Dev keystore or git-ignored `.env`. May read the key. | One process. Throwaway key generated for that run and discarded. | One process. KMS/HSM handle only (`SETTLEMENT_SIGNING_KEY_HANDLE`). Same signing path as production. | One process. KMS/HSM handle only. `sign` permission. No `export` or `get`. A raw private key in the environment or on disk is a failed deploy. |
| **Value the key can move** | Testnet channel balances only | None that persist | Testnet channel balances | Mainnet channel balances |

Keys that can move value, and the only place they may be loaded:

| Secret | What it can do | Where it is loaded |
|--------|----------------|--------------------|
| Settlement signing key (`SETTLEMENT_SIGNING_KEY_HANDLE` in staging and production; a dev key file only in local and CI) | Signs channel states. A signed state is an authorization to move the channel balance. | **Settlement engine only.** |
| `STELLAR_SECRET_KEY` | Signs Soroban transactions (submit, open, top-up, dispute) when chain writes are on. | The settlement engine process, if it submits. Not the gateway replicas, not the client, not the indexer. |
| `AGENT_MASTER_SEED` | Derives agent wallets when `ENABLE_BLOCKCHAIN=true`. Those addresses can spend. | Same single engine process, when that feature is on. |
| Deployer `STELLAR_SECRET_KEY` used by `contracts/scripts/deploy.sh` | Deploys and initializes contracts. | The operator shell for the deploy. Remove it from the shell when the deploy finishes. It is not a runtime secret. |

The client, the gateway, the meter, the indexer, Redis, and Postgres do not get these secrets. Postgres stores `channel_signer_lease.last_nonce_allocated` and signed states. That is not key material, and it must survive a rollback (see below).

Staging and production reach the signer over authenticated mTLS. The engine asks the signer to sign a digest. Startup in those environments is misconfigured if the process can read key bytes. Local and CI are the only environments where a file-backed key is allowed, and that file must not be a copy of the staging or production key. Details: [KEY_ROTATION_FLOW.md](../KEY_ROTATION_FLOW.md).

### Deploy order

Do these steps in order. Later steps assume the earlier ones have finished.

1. **Database.** Apply migrations, including `event_cursor` (singleton row `id = 1`, column `last_ledger`) and `channel_signer_lease` (`last_nonce_allocated`). The indexer cursor and the engine's nonce allocation both live in these tables.
2. **Contracts.** Deploy or upgrade on the network that belongs to this environment. Record every contract id in `deploy/manifests/<network>.json` (`sorobanContractAddress`, `sorobanRpcUrl`, `stellarNetworkUrl`, `deployedAt`, `commitSha`). Per-contract ids used by `getContractAddress` live in `contracts/deployments/<network>.json` or in `CONTRACT_ADDRESS_<NAME>`. See [contracts/DEPLOYMENT.md](../contracts/DEPLOYMENT.md).
3. **Gateway configuration, before traffic.** The gateway resolves registry scope and spend caps from those contract addresses. Load the manifest (the backend fills `SOROBAN_CONTRACT_ADDRESS`, `SOROBAN_RPC_URL`, and `STELLAR_NETWORK_URL` from `deploy/manifests/<network>.json` only when the env vars are unset). Confirm the addresses are for this environment's network. Leave the gateway out of the load balancer until step 6.
4. **Indexer.** Start it with the same `SOROBAN_CONTRACT_ADDRESS` and RPC as the manifest. If `SOROBAN_CONTRACT_ADDRESS` is empty, or `ENABLE_BLOCKCHAIN=false`, the indexer logs a warning and does not run — do not continue. Wait until it has caught up:

   ```sql
   SELECT last_ledger, updated_at FROM event_cursor WHERE id = 1;
   ```

   ```bash
   curl -s -X POST "$SOROBAN_RPC_URL" \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger","params":{}}'
   ```

   Proceed when `last_ledger` equals the RPC sequence. The engine reconciles closes and disputes from indexed rows in `blockchain_logs`. A stale cursor means it will act on a chain history it has not seen.
5. **Settlement engine.** One process, after the indexer is caught up. Procedure in the next subsection. It reads the indexer's stored events and the meter's closed windows, and it is the only process with the signing key.
6. **Gateway traffic.** Confirm `SOROBAN_CONTRACT_ADDRESS` and the per-contract ids match this environment's manifest. `GET /health/ready` only reports process dependencies (database, Redis); a 200 does not prove the contract addresses are loaded. Add the gateway to the load balancer after that check.
7. **Client.** Point `NEXT_PUBLIC_API_URL` at that gateway. The client has no settlement key and no contract-admin key.

Gateway replicas and client replicas can roll one at a time. The indexer should be a single reader of a given `event_cursor` row. The settlement engine cannot roll one at a time.

### Settlement engine: single signer

One settlement process may run in an environment. It holds the key that signs channel states. A second replica is not a standby you can leave running.

`channel_signer_lease` allows only one `instance_id` to allocate a nonce for a channel while its lease is unexpired. The lease lasts 30 seconds. When it expires, a different process can take the row over and keep `last_nonce_allocated`. Two running engines race: after 30 seconds the second process can take the lease and sign as well. Do not put the engine in an autoscaler, a rolling Deployment with `maxUnavailable` less than the full set, or a load balancer with more than one target.

What a deploy of this process actually is:

1. Confirm the indexer check above is green, on the same database and the same contract id.
2. Confirm `SETTLEMENT_SIGNING_KEY_HANDLE` is set on this process only. In staging and production the value is a KMS key id, and the IAM policy is `sign` only. Confirm no gateway replica, indexer, or client has `SETTLEMENT_SIGNING_KEY_HANDLE`, `STELLAR_SECRET_KEY`, or `AGENT_MASTER_SEED`.
3. Stop the current engine process. Leave every `channel_signer_lease` row in place. Do not call `release_channel_signer_lease`. That function **deletes** the row. The next acquire inserts a new row with `last_nonce_allocated` defaulting to 0, and the new process will sign nonces that were already used.
4. Wait until `lease_expires_at` is in the past for every row (30 seconds after the old process stopped, unless a clock is skewed). The row remains. The new process takes an expired lease and inherits `last_nonce_allocated`.
5. Start the new binary. One OS process.
6. Check the handoff before you send traffic:

   ```sql
   SELECT channel_id, instance_id, last_nonce_allocated, lease_expires_at
   FROM channel_signer_lease
   ORDER BY channel_id;
   ```

   After the first signature, `instance_id` matches the new process and nowhere else. The nonce it used is the previous `last_nonce_allocated` plus one.

`allocate_next_nonce` increments `last_nonce_allocated` before the signature is produced. A nonce that was allocated and then failed to sign is still consumed. The next signature uses the next integer.

### Rollback

Roll back application code in this order. Do not roll the database back to a snapshot taken before the release you are leaving.

1. Remove the gateway from the load balancer so no new paid calls are admitted and no new windows are handed to the engine.
2. Stop the settlement engine that is running the newer version. Do not delete lease rows and do not call `release_channel_signer_lease`.
3. Record the nonce floor **before** the older binary starts. You need this if the newer version signed anything:

   ```sql
   SELECT channel_id, last_nonce_allocated
   FROM channel_signer_lease
   ORDER BY channel_id;
   ```

   Also take the highest nonce stored for each channel in the signed-state rows the engine wrote. The floor for a channel is the greater of `last_nonce_allocated` and that stored nonce.
4. If a lease row is missing but a signed state from the newer version exists, insert or update the row so `last_nonce_allocated` equals that signed nonce. The only legal direction for this column is upward.
5. Start **one** process of the previous engine binary, on the same database, the same RPC, and the same key handle. Its first `allocate_next_nonce` returns `last_nonce_allocated + 1`.
6. Confirm that first new state uses a nonce strictly greater than every nonce the newer version allocated or signed, including nonces that were allocated and never submitted. Then return the gateway to the load balancer on the previous gateway build.

**A rollback must not re-sign nonce N with a different balance or payload if the newer version already allocated or signed N.** Two signatures at the same nonce let a counterparty submit the cheaper one. The older binary will do this if it sees a lower `last_nonce_allocated` than the newer version reached. That happens if you:

- restore a database snapshot from before those allocations
- `DELETE FROM channel_signer_lease`
- call `release_channel_signer_lease` (it deletes the row, and the next insert starts at 0)
- `UPDATE channel_signer_lease SET last_nonce_allocated` to a smaller number
- run the old process and the new process at the same time, including during the 30-second lease
- point the rolled-back engine at a different database than the one that recorded the newer nonces

If the floor you recorded is higher than the row the old binary can see, stop. Fix the row so `last_nonce_allocated` is at least that floor, then start the old binary again. Do not let it sign until that is true.

The gateway and the client roll back as ordinary stateless releases. They keep the contract addresses of the contracts that are actually deployed. An application rollback does not change contract ids and does not rewind channel nonces on chain.

The indexer rolls back as a binary replace. Leave `event_cursor.last_ledger` where it is. Reprocessing from an older cursor is safe: `blockchain_logs` upserts on `transaction_hash` and ignores duplicates. Moving `last_ledger` forward to skip a gap is not safe. After an indexer rollback, repeat the caught-up check and only then start the engine. The engine depends on the indexer; a rolled-back engine still needs a cursor at the tip of the chain it is reconciling.

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
| **App** | 2+ gateway replicas behind a load balancer; 2+ client replicas. Exactly one settlement-engine process and one indexer reader — see [Settlement engine: single signer](#settlement-engine-single-signer). |
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
- [ ] Deploy Soroban contracts — [contracts/DEPLOYMENT.md](../contracts/DEPLOYMENT.md) — and write the addresses into `deploy/manifests/<network>.json` before the gateway serves traffic.
- [ ] Copy and fill `backend/.env` and `client/.env.local` from templates. Put `SETTLEMENT_SIGNING_KEY_HANDLE` on the settlement engine process only, not on gateway replicas or the client.
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
- [ ] Start the indexer and wait until `event_cursor.last_ledger` matches the RPC tip. Then start **one** settlement engine. Bring the gateway up only after that. Full order and nonce-safe rollback: [v3 environments, deploy order, and rollback](#v3-environments-deploy-order-and-rollback).
- [ ] Configure reverse proxy and health checks (`/health/ready` on the gateway).
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
3. Scale the gateway (stateless API replicas behind the load balancer, shared Redis and Postgres). Do not add a second settlement-engine process. See [Settlement engine: single signer](#settlement-engine-single-signer).
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
| [KEY_ROTATION_FLOW.md](../KEY_ROTATION_FLOW.md) | Settlement signing-key custody, rotation, and compromise |
| [ops/contract-upgrade-runbook.md](./ops/contract-upgrade-runbook.md) | Contract upgrade and contract-level rollback |
| [backend/docs/channel-signer-lease-flow.md](../backend/docs/channel-signer-lease-flow.md) | Per-channel lease and nonce allocation |
