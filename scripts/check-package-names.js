#!/usr/bin/env node

/**
 * Validates intentional @syncro/* package names across the monorepo.
 * Fails CI if placeholder names (e.g. my-v0-project) reappear.
 *
 * Usage: node scripts/check-package-names.js
 * Exit code: 0 if valid, 1 if invalid
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

/** package.json path (relative to repo root) -> expected "name" field */
const EXPECTED_NAMES = {
  'client/package.json': '@syncro/client',
  'backend/package.json': '@syncro/backend',
  'sdk/package.json': '@syncro/sdk',
  'shared/package.json': '@syncro/shared',
  'temp_branch_files/package.json': '@syncro/client',
};

const PLACEHOLDER_PATTERNS = [
  /^my-v0-project$/i,
  /v0-project/i,
  /^my-app$/i,
  /^untitled/i,
];

function readPackageName(relativePath) {
  const filePath = path.join(REPO_ROOT, relativePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const pkg = JSON.parse(raw);
  return pkg.name;
}

function isPlaceholder(name) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(name));
}

function main() {
  const errors = [];

  for (const [relativePath, expected] of Object.entries(EXPECTED_NAMES)) {
    const actual = readPackageName(relativePath);
    if (actual !== expected) {
      errors.push(`${relativePath}: expected "${expected}", got "${actual}"`);
    }
    if (isPlaceholder(actual)) {
      errors.push(`${relativePath}: placeholder package name "${actual}"`);
    }
  }

  if (errors.length > 0) {
    console.error('Package name validation failed:\n');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log('All package names are intentional and consistent (@syncro/*).');
}

if (require.main === module) {
  main();
}

module.exports = { EXPECTED_NAMES, PLACEHOLDER_PATTERNS, readPackageName, isPlaceholder };
