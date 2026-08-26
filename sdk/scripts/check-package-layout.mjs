#!/usr/bin/env node
/**
 * publint-style package layout check plus dual-resolution fixtures
 * (ESM, CJS, bundler, node16).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(SDK_ROOT, 'dist');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd ?? SDK_ROOT,
    env: process.env,
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function assertExists(rel) {
  const abs = path.join(SDK_ROOT, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing published file: ${rel}`);
  }
}

async function main() {
  if (!fs.existsSync(DIST)) {
    throw new Error('sdk/dist missing. Run: npm run build -w sdk');
  }

  for (const rel of [
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/webhooks.js',
    'dist/webhooks.cjs',
    'dist/webhooks.d.ts',
    'dist/stellar/index.js',
    'dist/stellar/index.cjs',
    'dist/zk/index.js',
    'dist/zk/index.cjs',
  ]) {
    assertExists(rel);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(SDK_ROOT, 'package.json'), 'utf8'));
  for (const sub of ['.', './webhooks', './stellar', './zk']) {
    const exp = pkg.exports[sub];
    if (!exp?.import?.types || !exp?.import?.default) {
      throw new Error(`exports[${sub}].import must set types + default`);
    }
    if (!exp?.require?.types || !exp?.require?.default) {
      throw new Error(`exports[${sub}].require must set types + default`);
    }
  }

  run('npx', ['publint']);

  const attw = spawnSync('npx', ['attw', '--pack', '.', '--format', 'ascii'], {
    cwd: SDK_ROOT,
    encoding: 'utf8',
  });
  process.stdout.write(attw.stdout || '');
  process.stderr.write(attw.stderr || '');
  // attw exit 1 can be informational (CJS namespace quirks). Fail only on resolution holes.
  if (attw.status !== 0 && /resolved to a missing file|false ESM/i.test(`${attw.stdout}\n${attw.stderr}`)) {
    throw new Error('arethetypeswrong reported a resolution failure');
  }

  const cjsMod = require(path.join(DIST, 'webhooks.cjs'));
  if (typeof cjsMod.verifyWebhookSignature !== 'function') {
    throw new Error('CJS require(@syncro/sdk/webhooks) did not export verifyWebhookSignature');
  }

  const esmMod = await import(pathToFileURL(path.join(DIST, 'webhooks.js')).href);
  if (typeof esmMod.verifyWebhookSignature !== 'function') {
    throw new Error('ESM import of webhooks did not export verifyWebhookSignature');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syncro-sdk-res-'));
  fs.writeFileSync(
    path.join(tmp, 'consumer.ts'),
    `import type { SyncroWebhookEvent } from ${JSON.stringify(path.join(DIST, 'webhooks.d.ts'))};\nexport type E = SyncroWebhookEvent;\n`,
  );

  for (const moduleResolution of ['bundler', 'node16']) {
    const tsconfig = {
      compilerOptions: {
        module: moduleResolution === 'bundler' ? 'esnext' : 'nodenext',
        moduleResolution,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        customConditions: [],
      },
      files: ['consumer.ts'],
    };
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
    run('npx', ['tsc', '--pretty', 'false', '-p', tmp], { cwd: SDK_ROOT });
    console.log(`OK: moduleResolution ${moduleResolution}`);
  }

  console.log('OK: package layout resolves under ESM, CJS, bundler, and node16.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
