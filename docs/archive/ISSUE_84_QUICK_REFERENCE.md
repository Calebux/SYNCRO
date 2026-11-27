# Issue #84: Testnet Feature Flags — Quick Reference

**One-page guide for developers working with blockchain feature flags**

---

## The Three Flags

| Flag | Purpose | Default | Production |
|------|---------|---------|------------|
| `STELLAR_NETWORK` | Active network | `testnet` | Must be `mainnet` |
| `ENABLE_BLOCKCHAIN` | Master switch for on-chain writes | `true` | `true` or `false` |
| `ENABLE_TESTNET_ACTIONS` | Allow testnet-only operations | `false` | Must be `false` |

---

## Quick Usage

### Backend

```typescript
import {
  getBlockchainFlags,
  assertTestnetAllowed,
  assertBlockchainEnabled,
} from '../../../shared/blockchain-flags';

// Check flags
const flags = getBlockchainFlags();
if (flags.testnetActionsEnabled) {
  // safe to run testnet code
}

// Guard a testnet-only action (throws if not allowed)
assertTestnetAllowed('friendbot-fund');

// Guard an on-chain write (throws if blockchain disabled)
assertBlockchainEnabled('syncSubscription');
```

### Client

```typescript
import {
  isTestnetActionAllowed,
  isBlockchainEnabled,
} from '@/lib/feature-flags';

// Conditionally render testnet UI
if (isTestnetActionAllowed()) {
  return <FaucetButton />;
}

// Check blockchain switch
if (!isBlockchainEnabled()) {
  return <BlockchainDisabledNotice />;
}
```

---

## Environment Setup

### Development (`.env`)

```dotenv
STELLAR_NETWORK=testnet
ENABLE_BLOCKCHAIN=true
ENABLE_TESTNET_ACTIONS=true  # Allow testnet operations
```

### Production (`.env.production`)

```dotenv
STELLAR_NETWORK=mainnet
STELLAR_NETWORK_URL=https://soroban-rpc.creit.tech
SOROBAN_RPC_URL=https://soroban-rpc.creit.tech
STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
ENABLE_BLOCKCHAIN=true
ENABLE_TESTNET_ACTIONS=false  # MUST be false
```

---

## Common Errors

### Error: "Testnet-only action rejected"
**Cause**: `ENABLE_TESTNET_ACTIONS=false` (default)  
**Fix**: Set `ENABLE_TESTNET_ACTIONS=true` in development

### Error: "Production cannot use testnet"
**Cause**: `STELLAR_NETWORK=testnet` when `NODE_ENV=production`  
**Fix**: Set `STELLAR_NETWORK=mainnet` in production

### Error: "SOROBAN_RPC_URL is required in production"
**Cause**: Missing RPC URL in production  
**Fix**: Set `SOROBAN_RPC_URL=https://soroban-rpc.creit.tech`

---

## Testing

### Run Backend Tests
```bash
cd backend
npm test tests/blockchain-flags.test.ts
```

### Run Client Tests
```bash
cd client
npm test lib/__tests__/blockchain-flags.test.ts
```

---

## Production Checklist

Before deploying to production:

- [ ] `STELLAR_NETWORK=mainnet`
- [ ] `NEXT_PUBLIC_STELLAR_NETWORK=mainnet`
- [ ] RPC URLs point to mainnet
- [ ] `STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015`
- [ ] `ENABLE_TESTNET_ACTIONS=false` (or absent)
- [ ] `NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS=false` (or absent)
- [ ] All tests passing
- [ ] Smart contracts deployed to mainnet

---

## Files to Know

| File | Purpose |
|------|---------|
| `shared/blockchain-flags.ts` | Core flag logic |
| `backend/src/config/env.ts` | Production validation |
| `client/lib/feature-flags.ts` | React helpers |
| `docs/blockchain-feature-flags.md` | Full documentation |

---

## Need Help?

1. Read the full docs: `docs/blockchain-feature-flags.md`
2. Check the tests for examples
3. Review `.env.example` files

---

**Quick Links**:
- Full Documentation: `docs/blockchain-feature-flags.md`
- Implementation Summary: `ISSUE_84_IMPLEMENTATION_COMPLETE.md`
- PR Guide: `ISSUE_84_PR_GUIDE.md`
- Verification Summary: `ISSUE_84_VERIFICATION_SUMMARY.md`
