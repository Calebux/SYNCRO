#!/usr/bin/env node
/**
 * Fail if the SDK browser crypto/zk/stellar entrypoints import Node builtins.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'dist/crypto/browser.js',
  'src/crypto/browser.ts',
  'src/zk/proof-generator.ts',
  'src/stellar/index.ts',
];

const forbidden = /from ['"]node:crypto['"]|require\(['"]crypto['"]\)|require\(['"]node:crypto['"]\)/;
let failed = false;

for (const rel of files) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const source = fs.readFileSync(full, 'utf8');
  if (forbidden.test(source)) {
    console.error(`Node crypto builtin found in ${rel}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log('SDK browser crypto paths contain no node:crypto import.');
