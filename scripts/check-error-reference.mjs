#!/usr/bin/env node
/**
 * Fail if generated error reference is stale.
 * Regenerates in a temp location and compares to the committed file.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_PATH = path.join(ROOT, 'tmp', 'errors.mdx');
const OUT_PATH = path.join(ROOT, 'docs', 'api-reference', 'errors.mdx');

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
  // Ensure temp directory exists
  const tmpDir = path.dirname(TEMP_PATH);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // Generate to temp file
  run('node', [
    'scripts/generate-error-reference.mjs',
    '--out',
    TEMP_PATH,
  ]);

  // Compare
  const diff = spawnSync('git', ['diff', '--no-index', '--exit-code', TEMP_PATH, OUT_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (diff.status === 0) {
    console.log('Error reference is up to date.');
    process.exit(0);
  } else if (diff.status === 1) {
    console.error('Error reference is stale. Please run:');
    console.error('  node scripts/generate-error-reference.mjs');
    console.error('and commit the result.');
    // Show diff
    const diffOutput = spawnSync('git', ['diff', '--no-index', TEMP_PATH, OUT_PATH], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (diffOutput.stdout) process.stdout.write(diffOutput.stdout);
    process.exit(1);
  } else {
    // error running diff
    if (diff.stderr) process.stderr.write(diff.stderr);
    process.exit(diff.status);
  }
}

// Allow specifying output file via arg --out <path>
const args = process.argv.slice(2);
if (args.includes('--out')) {
  const idx = args.indexOf('--out');
  if (idx + 1 < args.length) {
    // Override OUT_PATH
    const provided = args[idx + 1];
    // For simplicity, we just replace OUT_PATH for generator; but we need to adjust generator to accept arg.
    // Instead, we'll modify generator to accept argument; but for now, we'll just hardcode.
    // We'll update generator to accept optional arg.
    // Let's instead modify generator to accept --out.
    // We'll do that after.
  }
}

main();
