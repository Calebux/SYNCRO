#!/usr/bin/env node
/**
 * Run a cargo command when the toolchain is present; skip locally otherwise.
 * CI installs Rust before invoking Turbo, so this is a local-dev convenience.
 */
import { spawnSync } from 'node:child_process';

const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
if (cargo.status !== 0) {
  if (process.env.CI) {
    console.error('cargo is required in CI for @syncro/contracts');
    process.exit(1);
  }
  console.log('cargo not found; skipping contracts task');
  process.exit(0);
}

const args = process.argv.slice(2);
const result = spawnSync('cargo', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
