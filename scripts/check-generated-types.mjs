#!/usr/bin/env node
/**
 * Fail if generated database / contract types are stale.
 * Regenerates artifacts in a temp copy and compares to the working tree.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TRACKED = [
  'supabase/schema.snapshot.json',
  'shared/src/generated/database.ts',
  'shared/src/generated/soroban-abi.json',
  'shared/src/generated/contracts.ts',
  'sdk/src/generated/contracts.ts',
  'sdk/src/generated/transaction-builders.ts',
  'sdk/src/generated/index.ts',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function main() {
  run('node', ['scripts/generate-db-types.mjs']);
  run('node', ['scripts/generate-contract-types.mjs']);
  run('node', ['sdk/scripts/generate-contract-bindings.cjs']);

  const dirty = [];
  for (const rel of TRACKED) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      dirty.push(`${rel} (missing)`);
      continue;
    }
    const status = spawnSync('git', ['status', '--porcelain', '--', rel], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if ((status.stdout || '').trim()) dirty.push(rel);
  }

  if (dirty.length > 0) {
    console.error('Generated types are stale. Run:');
    console.error('  npm run generate -w shared && npm run generate:contracts -w sdk');
    console.error('and commit the result.');
    console.error('Drift:');
    for (const file of dirty) console.error(`  - ${file}`);
    process.exit(1);
  }

  console.log('Generated database and contract types are up to date.');
}

main();
