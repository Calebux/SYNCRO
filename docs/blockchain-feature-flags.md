# Blockchain Feature Flags

**Issue**: #84 — Testnet-only actions must be feature-flagged; production builds must reject unsafe paths.

---

## Overview

SYNCRO uses Stellar Soroban smart contracts for on-chain subscription logging. Because the contracts are currently deployed on **testnet only**, there is a risk that testnet-oriented code paths could accidentally run in a production environment.

This document describes the feature-flag system that prevents that from happening.

---

## Flags

All flags are defined in `shared/blockchain-flags.ts` and consumed by both the backend (Node.js) and the client (Next.js).

### `STELLAR_NETWORK` / `NEXT_PUBLIC_STELLAR_NETWORK`

The active Stellar network.

| Value | Meaning |
|-------|---------|
| `testnet` | Stellar testnet (default in development) |
| `mainnet` or `public` | Stellar mainnet (required in production) |
| `futurenet` | Stellar futurenet (experimental) |

**Production requirement**: must be set to `mainnet`. The backend will refuse to start if this is set to `testnet` or `futurenet` when `NODE_ENV=production`.

### `ENABLE_TESTNET_ACTIONS` / `NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS`

Controls whether testnet-only actions are permitted.

| Value | Behaviour |
|-------|-----------|
| `false` (default) | Testnet-only actions are blocked |
| `true` | Testnet-only actions are allowed (non-mainnet only) |

**Production requirement**: must be `false` (or absent). The backend will refuse to start if this is `true` when `NODE_ENV=production`. Even if set to `true`, it is always overridden to `false` on mainnet.

Testnet-only actions include:
- Friendbot / faucet funding
- Testnet contract deployments
- Testnet wallet connections

### `ENABLE_BLOCKCHAIN` / `NEXT_PUBLIC_ENABLE_BLOCKCHAIN`

Master switch for all on-chain writes.

| Value | Behaviour |
|-------|-----------|
| `true` (default) | On-chain writes are enabled |
| `false` | All blockchain writes are disabled; events fall back to database-only logging |

Use this flag to disable blockchain writes in staging or when the Soroban RPC is unavailable, without removing contract addresses from the environment.

---

## Environment Variable Reference

### Backend (`backend/.env`)

```dotenv
# Active Stellar network — MUST be "mainnet" in production
STELLAR_NETWORK=testnet

# RPC endpoint — MUST be set explicitly in production (no testnet fallback)
STELLAR_NETWORK_URL=https://soroban-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Network passphrase — MUST be set explicitly in production
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Master switch for on-chain writes
ENABLE_BLOCKCHAIN=true

# Testnet-only actions — MUST be false in production
ENABLE_TESTNET_ACTIONS=false
```

### Client (`client/.env.local`)

```dotenv
# Active Stellar network
NEXT_PUBLIC_STELLAR_NETWORK=testnet

# RPC endpoint — MUST be set explicitly in production
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Master switch for on-chain writes
NEXT_PUBLIC_ENABLE_BLOCKCHAIN=true

# Testnet-only actions — MUST be false in production
NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS=false
```

---

## Production Safety Checks

The following checks run automatically at startup and will **crash the process** if violated:

### Backend (`backend/src/config/env.ts`)

1. `SOROBAN_RPC_URL` / `STELLAR_NETWORK_URL` must not contain `testnet` or `futurenet` when `NODE_ENV=production`.
2. `STELLAR_NETWORK_PASSPHRASE` must not contain `test` when `NODE_ENV=production`.
3. `STELLAR_NETWORK` must be `mainnet` when `NODE_ENV=production`.
4. `ENABLE_TESTNET_ACTIONS` must not be `true` when `NODE_ENV=production`.

### Service-level guards

| Service | Guard |
|---------|-------|
| `BlockchainService` | Throws in constructor if `SOROBAN_RPC_URL` or `STELLAR_NETWORK_PASSPHRASE` is missing in production |
| `EventListener` | Sets `status=disabled` with an error log if `STELLAR_NETWORK_URL` is missing in production |
| `Indexer` | Throws at module load if `SOROBAN_RPC_URL` is missing in production |
| `GasPredictorService` | Throws if `NEXT_PUBLIC_SOROBAN_RPC_URL` is missing in production |
| `StellarWalletService` | Throws if `connect('testnet')` is called in production without `ENABLE_TESTNET_ACTIONS=true` |

---

## Blockchain event schema versioning

Event payloads are versioned so producers and consumers can evolve safely.

- Current contract event payload schema version: `1`
- Event values may include an optional `schema_version` field inside the contract event `value` object.
- Consumers validate the schema version before parsing or processing.
- Events without `schema_version` are treated as legacy version `1` for backward compatibility.
- Unsupported versions are ignored and logged, avoiding brittle failures when payload shapes change.

### Versioning guidance

- For non-breaking field additions, continue using version `1` and accept the new fields gracefully.
- For breaking payload changes, increment `schema_version` and update backend/SDK consumers before deploying producers.
- Document all breaking schema changes here and in the contract event producer implementation.

---

## Using the Flags in Code

### Backend

```typescript
import {
  getBlockchainFlags,
  assertTestnetAllowed,
  assertBlockchainEnabled,
  assertNetwork,
} from '../../../shared/blockchain-flags';

// Check flags
const flags = getBlockchainFlags();
if (flags.testnetActionsEnabled) {
  // safe to run testnet-only code
}

// Guard a testnet-only action (throws if not allowed)
assertTestnetAllowed('friendbot-fund');

// Guard an on-chain write (throws if ENABLE_BLOCKCHAIN=false)
assertBlockchainEnabled('syncSubscription');

// Guard a network-specific operation
assertNetwork('mainnet', 'production-deploy');
```

### Client (React / Next.js)

```typescript
import {
  isTestnetActionAllowed,
  isBlockchainEnabled,
  getFeatureFlags,
} from '@/lib/feature-flags';

// Conditionally render testnet UI
if (isTestnetActionAllowed()) {
  // show faucet button, testnet badge, etc.
}

// Check master blockchain switch
if (!isBlockchainEnabled()) {
  // show "blockchain writes disabled" notice
}

// Access all flags at once
const flags = getFeatureFlags();
console.log(flags.testnetActionsEnabled, flags.blockchainEnabled);
```

---

## Production Deployment Checklist

Before deploying to production, verify:

- [ ] `STELLAR_NETWORK=mainnet` (backend)
- [ ] `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` (client)
- [ ] `STELLAR_NETWORK_URL` points to a mainnet RPC endpoint
- [ ] `SOROBAN_RPC_URL` points to a mainnet RPC endpoint
- [ ] `NEXT_PUBLIC_SOROBAN_RPC_URL` points to a mainnet RPC endpoint
- [ ] `STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015`
- [ ] `ENABLE_TESTNET_ACTIONS` is absent or `false`
- [ ] `NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS` is absent or `false`
- [ ] `ENABLE_BLOCKCHAIN=true` (or `false` if intentionally disabling on-chain writes)
- [ ] Smart contracts have passed security audit before mainnet deployment

---

## Testing

### Backend

```bash
cd backend
npx jest tests/blockchain-flags.test.ts --verbose
```

### Client

```bash
cd client
npx vitest run lib/__tests__/blockchain-flags.test.ts
```

---

## Related Files

| File | Role |
|------|------|
| `shared/blockchain-flags.ts` | Flag definitions, helpers, and guards |
| `backend/src/config/env.ts` | Zod schema + production safety checks |
| `backend/src/services/blockchain-service.ts` | Uses flags in constructor and `invokeContractWithRetry` |
| `backend/src/services/event-listener.ts` | Uses flags in constructor |
| `backend/src/blockchain/indexer.ts` | Uses flags at module load and in `startIndexer` |
| `client/lib/feature-flags.ts` | Exposes blockchain flags to React components |
| `client/lib/gas-predictor.ts` | Production RPC guard in `getRpcUrl` |
| `client/lib/stellar-wallet.ts` | Testnet connection guard in `connect` |
| `backend/.env.example` | Documents all new env vars |
| `backend/tests/blockchain-flags.test.ts` | Backend tests |
| `client/lib/__tests__/blockchain-flags.test.ts` | Client tests |
