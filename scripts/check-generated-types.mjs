#!/usr/bin/env node
/**
 * Fail if generated database / contract types are stale.
 * Regenerates artifacts, compares them to the working tree, and restores them.
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
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function main() {
  const originalFiles = new Map(
    TRACKED.map((rel) => {
      const abs = path.join(ROOT, rel);
      return [rel, fs.existsSync(abs) ? fs.readFileSync(abs) : null];
    }),
  );
  const dirty = [];

  try {
    run('node', ['scripts/generate-db-types.mjs']);
    run('node', ['scripts/generate-contract-types.mjs']);
    run('npm', ['run', 'build', '-w', 'shared']);
    run('node', ['sdk/scripts/generate-contract-bindings.cjs']);

    for (const [rel, original] of originalFiles) {
      const abs = path.join(ROOT, rel);
      if (
        original === null ||
        !fs.existsSync(abs) ||
        !original.equals(fs.readFileSync(abs))
      ) {
        dirty.push(rel);
      }
    }
  } finally {
    for (const [rel, original] of originalFiles) {
      const abs = path.join(ROOT, rel);
      if (original === null) {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } else if (
        !fs.existsSync(abs) ||
        !original.equals(fs.readFileSync(abs))
      ) {
        fs.writeFileSync(abs, original);
      }
    }
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
