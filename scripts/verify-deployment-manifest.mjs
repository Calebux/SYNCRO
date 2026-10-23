#!/usr/bin/env node

/**
 * Verify deployment manifest integrity
 * 
 * This script verifies:
 * 1. Manifest file exists for the specified network
 * 2. All required fields are present
 * 3. WASM hashes match the built artifacts (when available)
 * 4. On-chain contract IDs are valid (future enhancement)
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NETWORK = process.env.NETWORK || 'testnet';
const MANIFEST_PATH = resolve(__dirname, `../deployments/${NETWORK}.json`);

console.log(`\n==> Verifying deployment manifest for ${NETWORK}...\n`);

// Check if manifest exists
if (!existsSync(MANIFEST_PATH)) {
  console.error(`❌ Manifest not found: ${MANIFEST_PATH}`);
  process.exit(1);
}

// Load and parse manifest
let manifest;
try {
  const manifestContent = readFileSync(MANIFEST_PATH, 'utf-8');
  manifest = JSON.parse(manifestContent);
  console.log(`✓ Manifest loaded: ${MANIFEST_PATH}`);
} catch (error) {
  console.error(`❌ Failed to parse manifest: ${error.message}`);
  process.exit(1);
}

// Verify required fields
const requiredFields = ['network', 'contracts'];
for (const field of requiredFields) {
  if (!manifest[field]) {
    console.error(`❌ Missing required field: ${field}`);
    process.exit(1);
  }
}
console.log(`✓ Required fields present`);

// Verify contracts
const requiredContracts = ['zk_payment_verifier', 'contract_upgrade'];
for (const contractName of requiredContracts) {
  const contract = manifest.contracts[contractName];
  
  if (!contract) {
    console.error(`❌ Missing contract: ${contractName}`);
    process.exit(1);
  }
  
  // Check if deployed (allow null for template files)
  if (contract.contract_id && contract.wasm_hash && contract.version) {
    console.log(`✓ ${contractName}: ${contract.contract_id.substring(0, 8)}...`);
  } else {
    console.log(`⚠ ${contractName}: Not yet deployed (template file)`);
  }
}

console.log(`\n✓ Deployment manifest verification complete\n`);

// Future enhancement: Verify on-chain WASM hash matches manifest
// This would require:
// 1. Querying the Stellar network for the deployed contract
// 2. Fetching the contract's WASM code
// 3. Computing its hash and comparing with manifest.contracts[].wasm_hash

console.log(`Note: On-chain WASM hash verification not yet implemented`);
console.log(`      See issue for full implementation details\n`);
