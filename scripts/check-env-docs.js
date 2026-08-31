#!/usr/bin/env node
// scripts/check-env-docs.js
//
// Repo-wide STRUCTURAL env check (issue #601). Secret-free — safe to run on
// every PR. Asserts the canonical env strategy holds:
//
//   - Each runtime package that consumes env has an env.manifest.js and an
//     .env.example, and they are in perfect sync (every manifest var is
//     documented, every documented var is in the manifest, no deprecated
//     names leak into .env.example).
//   - Each library / non-JS package that consumes NO runtime env stays that
//     way (no manifest, no .env.example) — so the "no env" claim in
//     docs/ENVIRONMENT.md is enforced, not just asserted in prose.
//
// Exits non-zero on any drift. See docs/ENVIRONMENT.md.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Packages that consume runtime env: each must have a manifest + .env.example. */
const ENV_PACKAGES = [
  { name: 'backend', dir: 'backend' },
  { name: 'client', dir: 'client' },
];

/** Packages with NO runtime env: must NOT carry a manifest or .env.example. */
const NO_ENV_PACKAGES = [
  { name: 'sdk', dir: 'sdk' },
  { name: 'shared', dir: 'shared' },
  { name: 'contracts', dir: 'contracts' },
  { name: 'quota_guard', dir: 'quota_guard' },
];

/** Parse the top-level KEY= names out of a .env file. */
function parseEnvExampleKeys(filePath) {
  const contents = fs.readFileSync(filePath, 'utf8');
  const keys = new Set();
  for (const line of contents.split('\n')) {
    const match = /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim());
    if (match) keys.add(match[1]);
  }
  return keys;
}

const problems = [];

for (const pkg of ENV_PACKAGES) {
  const manifestPath = path.join(ROOT, pkg.dir, 'scripts', 'env.manifest.js');
  const examplePath = path.join(ROOT, pkg.dir, '.env.example');

  if (!fs.existsSync(manifestPath)) {
    problems.push(`[${pkg.name}] missing env manifest: ${pkg.dir}/scripts/env.manifest.js`);
    continue;
  }
  if (!fs.existsSync(examplePath)) {
    problems.push(`[${pkg.name}] missing ${pkg.dir}/.env.example`);
    continue;
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const manifest = require(manifestPath);
  const declared = new Set([...manifest.required, ...manifest.optional]);
  const documented = parseEnvExampleKeys(examplePath);

  for (const key of declared) {
    if (!documented.has(key)) {
      problems.push(`[${pkg.name}] manifest var not documented in .env.example: ${key}`);
    }
  }
  for (const key of documented) {
    if (!declared.has(key)) {
      problems.push(
        `[${pkg.name}] .env.example var not in manifest (add to ${pkg.dir}/scripts/env.manifest.js): ${key}`,
      );
    }
  }
  for (const key of Object.keys(manifest.deprecated || {})) {
    if (documented.has(key)) {
      problems.push(
        `[${pkg.name}] deprecated var present in .env.example: ${key} → ${manifest.deprecated[key]}`,
      );
    }
  }

  // Required must be a subset of optional-free required (no key in both lists).
  const overlap = manifest.required.filter((k) => manifest.optional.includes(k));
  if (overlap.length) {
    problems.push(`[${pkg.name}] vars listed in both required and optional: ${overlap.join(', ')}`);
  }
}

for (const pkg of NO_ENV_PACKAGES) {
  const manifestPath = path.join(ROOT, pkg.dir, 'scripts', 'env.manifest.js');
  const examplePath = path.join(ROOT, pkg.dir, '.env.example');
  if (fs.existsSync(manifestPath) || fs.existsSync(examplePath)) {
    problems.push(
      `[${pkg.name}] is declared as a no-env package but has a manifest/.env.example. ` +
        'If it now needs runtime env, move it to ENV_PACKAGES and document it in docs/ENVIRONMENT.md.',
    );
  }
}

if (problems.length) {
  console.error('\n❌ Env documentation structural check failed:\n');
  problems.forEach((p) => console.error(`   - ${p}`));
  console.error('\nSee docs/ENVIRONMENT.md for the canonical env strategy.\n');
  process.exit(1);
}

console.log('✅ Env manifests and .env.example files are consistent across all packages.');
