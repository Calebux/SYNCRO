# Deployment Manifests

This directory contains network-specific deployment manifests for Stellar smart contracts.

## Structure

Each network has its own JSON file:
- `testnet.json` - Testnet deployments
- `mainnet.json` - Mainnet deployments (future)

## Schema

Each deployment manifest contains:

```json
{
  "network": "testnet",
  "deployed_at": "2026-10-17T12:00:00Z",
  "deployed_ledger": 123456,
  "deployer_address": "G...",
  "commit_sha": "abc123...",
  "contracts": {
    "zk_payment_verifier": {
      "contract_id": "C...",
      "wasm_hash": "...",
      "version": "1.0.0"
    },
    "contract_upgrade": {
      "contract_id": "C...",
      "wasm_hash": "...",
      "version": "1.0.0"
    }
  }
}
```

## Usage

### Generate deployment manifest
The deploy script automatically generates these files:

```bash
cd contracts/scripts
./deploy.sh testnet
```

### Load in backend
```typescript
import deployments from '../../../deployments/testnet.json';
const contractId = deployments.contracts.zk_payment_verifier.contract_id;
```

### Load in SDK
```typescript
import { getDeployment } from '@syncro/sdk';
const deployment = getDeployment('testnet');
```

## CI Verification

The CI pipeline verifies:
1. On-chain WASM hash matches the manifest
2. Contract IDs are valid and deployed
3. Version numbers are consistent with package.json
