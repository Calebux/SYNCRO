#!/usr/bin/env node
/**
 * Fail PRs that change a publishable package (sdk, shared) without a changeset.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHABLE = ['sdk/', 'shared/'];
const CHANGESET_DIR = path.join(ROOT, '.changeset');

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return (result.stdout || '').trim();
}

function baseRef() {
  if (process.env.CHANGESET_BASE) return process.env.CHANGESET_BASE;
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  const originMain = spawnSync('git', ['rev-parse', '--verify', 'origin/main'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (originMain.status === 0) return 'origin/main';
  return 'main';
}

function main() {
  const base = baseRef();
  spawnSync('git', ['fetch', '--depth=1', 'origin', base.replace(/^origin\//, '')], {
    cwd: ROOT,
  });
  const diff = git(['diff', '--name-only', `${base}...HEAD`]);
  const changed = diff.split('\n').filter(Boolean);
  const publishableChanged = changed.filter((file) =>
    PUBLISHABLE.some((prefix) => file.startsWith(prefix)),
  );

  if (publishableChanged.length === 0) {
    console.log('No publishable package changes; changeset not required.');
    return;
  }

  const files = fs.existsSync(CHANGESET_DIR)
    ? fs.readdirSync(CHANGESET_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md')
    : [];

  if (files.length === 0) {
    console.error('Publishable packages changed without a changeset:');
    for (const file of publishableChanged) console.error(`  - ${file}`);
    console.error('\nRun: npx changeset');
    process.exit(1);
  }

  console.log(`Found ${files.length} changeset(s) for publishable package changes.`);
}

main();
