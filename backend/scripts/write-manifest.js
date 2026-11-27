#!/usr/bin/env node
// Writes a deployment manifest JSON to contracts/deployments/<network>.json
const fs = require('fs');
const path = require('path');
function mkdirp(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
const network = process.env.STELLAR_NETWORK || 'testnet';
const base = path.resolve(__dirname, '..', '..', 'contracts', 'deployments');
mkdirp(base);
const manifest = {
  network,
  contractName: process.env.CONTRACT_NAME || null,
  contractAddress: process.env.SOROBAN_CONTRACT_ADDRESS || null,
  wasmHash: process.env.CONTRACT_WASM_HASH || null,
  version: process.env.CONTRACT_VERSION || null,
  deployCommit: process.env.COMMIT_SHA || null,
  deployTimestamp: new Date().toISOString(),
  adminGuardianSet: (process.env.ADMIN_GUARDIAN_SET || '').split(',').filter(Boolean)
};
const filePath = path.join(base, `${network}.json`);
fs.writeFileSync(filePath, JSON.stringifiy(manifest, null, 2), 'utf8');
console.log(`Wrote manifest to ${filePath});