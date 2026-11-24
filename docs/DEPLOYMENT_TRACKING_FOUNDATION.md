# Deployment Tracking Foundation (1% Implementation)

This PR establishes the foundation for centralized contract deployment tracking, solving 1% of the issue by creating the infrastructure and patterns for the full implementation.

## What's Implemented

### 1. Directory Structure
- Created `deployments/` directory for network-specific manifests
- Added `deployments/testnet.json` template
- Documented structure in `deployments/README.md`

### 2. Deploy Script Enhancement
- Modified `contracts/scripts/deploy.sh` to generate deployment manifests
- Captures:
  - Contract IDs
  - WASM hashes (SHA256 of built artifacts)
  - Version from Cargo.toml
  - Deployed timestamp
  - Deployer address
  - Git commit SHA

### 3. Type-Safe Loading
- Created `shared/src/deployment-manifest.ts` with TypeScript types
- Provides utilities:
  - `loadDeploymentManifest(network)` - Load manifest for a network
  - `getContractId(network, contractName)` - Get specific contract ID
  - `validateDeployment(manifest)` - Validate all required contracts present

### 4. Backend Integration
- Created `backend/src/config/deployment.config.ts`
- Loads contract IDs from manifest files
- Falls back to environment variables (legacy support)
- Exports ready-to-use contract ID constants

### 5. CI Verification Script
- Created `scripts/verify-deployment-manifest.mjs`
- Verifies manifest file integrity
- Validates required fields
- Ready for enhancement with on-chain hash verification

### 6. Package Script
- Added `npm run verify:deployment` to root package.json

## File Changes

```
deployments/
├── .gitkeep
├── README.md
└── testnet.json (template)

contracts/scripts/
└── deploy.sh (enhanced)

shared/src/
└── deployment-manifest.ts (new)

backend/src/config/
└── deployment.config.ts (new)

scripts/
└── verify-deployment-manifest.mjs (new)

package.json (updated)
```

## Usage Example

### Deploy to testnet
```bash
cd contracts/scripts
export STELLAR_SECRET_KEY="S..."
./deploy.sh testnet
```

This will:
1. Build contracts
2. Deploy to Stellar testnet
3. Generate `deployments/testnet.json` with all metadata
4. Commit the deployment manifest

### Load in backend
```typescript
import { zkVerifierContractId } from './config/deployment.config';

// Use the contract ID
const result = await stellarClient.call(zkVerifierContractId, method, params);
```

### Verify deployment
```bash
npm run verify:deployment
# or for specific network
NETWORK=testnet npm run verify:deployment
```

## What's Next (Remaining 99%)

### Phase 2: SDK Integration
- Export deployment info from SDK
- Create `@syncro/sdk/deployment` module
- Provide client-side access to contract IDs

### Phase 3: CI Verification
- Implement on-chain WASM hash verification
- Query Stellar network for deployed contracts
- Compare on-chain hash with manifest
- Add to CI pipeline for testnet deployments

### Phase 4: Complete Migration
- Find and replace all hardcoded contract IDs in:
  - Backend services
  - SDK methods
  - Client configuration
  - Documentation
- Remove contract ID environment variables
- Update deployment documentation

### Phase 5: Mainnet Support
- Create `deployments/mainnet.json`
- Establish mainnet deployment process
- Add mainnet verification to CI

## Benefits

✅ **Single Source of Truth**: One file per network contains all deployment info  
✅ **Version Tracking**: Know which version is deployed where  
✅ **Git History**: Deployment changes are tracked in version control  
✅ **Type Safety**: TypeScript types prevent runtime errors  
✅ **CI Integration**: Ready for automated verification  
✅ **Developer Experience**: No more hunting for contract IDs in env files  

## Testing

```bash
# Verify the manifest structure
NETWORK=testnet npm run verify:deployment

# Test the verification script works
npm run verify:deployment
```

## Acceptance Criteria Progress

- [x] Created deployment manifest structure
- [x] Enhanced deploy script to generate JSON files
- [x] Created loading utilities for backend
- [x] Added verification script foundation
- [ ] Backend reads ALL contract IDs from manifest (partial - config created)
- [ ] SDK exports deployment info (planned)
- [ ] CI checks on-chain WASM hash (script stub created)

**Progress: 1% complete** - Foundation laid for full implementation
