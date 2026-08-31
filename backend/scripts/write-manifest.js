#!/usr/bin/env node
// Writes a deployment manifest JSON to deploy/manifests/<network>.json

const fs = require('fs');
const path = require('path');

function mkdirp(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const network = process.env.STELLAR_NETWORK || 'testnet';
const base = path.resolve(__dirname, '..', '..', 'deploy', 'manifests');
mkdirp(base);

const manifest = {
  network,
  sorobanContractAddress: process.env.SOROBAN_CONTRACT_ADDRESS || null,
  sorobanRpcUrl: process.env.SOROBAN_RPC_URL || process.env.STELLAR_NETWORK_URL || null,
  stellarNetworkUrl: process.env.STELLAR_NETWORK_URL || null,
  deployedAt: new Date().toISOString(),
  commitSha: process.env.COMMIT_SHA || null,
};

const filePath = path.join(base, `${network}.json`);
fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Wrote manifest to ${filePath}`);
