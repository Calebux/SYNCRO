#!/usr/bin/env node
/**
 * Measure `npm pack` unpacked size against sdk/package-size.json.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = path.join(SDK_ROOT, 'package-size.json');

function extractJson(stdout) {
  const text = stdout.trim();
  const startArr = text.indexOf('[');
  const startObj = text.indexOf('{');
  let start = -1;
  if (startArr >= 0 && (startObj < 0 || startArr < startObj)) start = startArr;
  else start = startObj;
  if (start < 0) throw new Error(`npm pack produced no JSON:\n${text}`);
  return JSON.parse(text.slice(start));
}

function main() {
  const budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: SDK_ROOT,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'error' },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'npm pack failed');
    process.exit(1);
  }

  const parsed = extractJson(`${result.stdout}\n${result.stderr}`);
  const info = Array.isArray(parsed) ? parsed[0] : parsed;
  const unpacked = Number(info.unpackedSize ?? info.size ?? 0);
  const packed = Number(info.size ?? 0);

  const report = {
    name: info.name,
    version: info.version,
    unpackedSizeBytes: unpacked,
    packedSizeBytes: packed,
    budgetUnpackedSizeBytes: budget.unpackedSizeBytes,
    filename: info.filename,
  };

  console.log(JSON.stringify(report, null, 2));

  if (unpacked > budget.unpackedSizeBytes) {
    console.error(
      `Published package unpacked size ${unpacked} exceeds budget ${budget.unpackedSizeBytes}.`,
    );
    process.exit(1);
  }

  const warnAt = Math.floor(budget.unpackedSizeBytes * (budget.warnRatio ?? 0.9));
  if (unpacked > warnAt) {
    console.warn(`Warning: package size ${unpacked} is over 90% of budget ${budget.unpackedSizeBytes}.`);
  }
}

main();
