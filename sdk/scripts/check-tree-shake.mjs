#!/usr/bin/env node
/**
 * Prove subpath builds are isolated: importing /webhooks must not include
 * stellar or zk, and vice versa. Inspects the published dist files (the
 * artifacts consumers actually resolve).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(SDK_ROOT, 'dist');

const AREAS = {
  webhooks: ['webhooks.js', 'webhooks.cjs'],
  stellar: [path.join('stellar', 'index.js'), path.join('stellar', 'index.cjs')],
  zk: [path.join('zk', 'index.js'), path.join('zk', 'index.cjs')],
};

const FORBIDDEN = {
  webhooks: [
    'generatePaymentProof',
    'buildSyncroMemo',
    'createPaymentCommitment',
    'proof-generator',
    '@syncro/shared/crypto',
  ],
  stellar: [
    'generatePaymentProof',
    'verifyWebhookSignature',
    'createPaymentCommitment',
    '@syncro/shared/crypto',
    'SYNCRO_WEBHOOK_HEADERS',
  ],
  zk: [
    'verifyWebhookSignature',
    'buildSyncroMemo',
    'SYNCRO_WEBHOOK_HEADERS',
  ],
};

function read(rel) {
  const abs = path.join(DIST, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing ${abs}. Run: npm run build -w sdk`);
  }
  return fs.readFileSync(abs, 'utf8');
}

function main() {
  const sizes = {};
  const failures = [];

  for (const [area, files] of Object.entries(AREAS)) {
    let combined = '';
    let bytes = 0;
    for (const file of files) {
      const code = read(file);
      combined += `\n${code}`;
      bytes += Buffer.byteLength(code, 'utf8');
    }
    sizes[area] = bytes;
    for (const token of FORBIDDEN[area]) {
      if (combined.includes(token)) {
        failures.push(`@syncro/sdk/${area} contains forbidden token: ${token}`);
      }
    }
  }

  if (sizes.webhooks >= sizes.zk * 4) {
    failures.push(
      `webhooks (${sizes.webhooks} B) unexpectedly large vs zk (${sizes.zk} B)`,
    );
  }

  console.log('Subpath dist sizes (js + cjs):');
  for (const [area, size] of Object.entries(sizes)) {
    console.log(`  ${area}: ${size} bytes`);
  }

  if (failures.length > 0) {
    console.error('\nTree-shake check failed:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('OK: importing one subpath does not pull in the others.');
}

main();
