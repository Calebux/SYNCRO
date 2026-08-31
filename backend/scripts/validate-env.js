#!/usr/bin/env node
// backend/scripts/validate-env.js
//
// Two modes:
//   (default)      Strict presence check. Fails if any REQUIRED var is absent.
//                  Run before starting/deploying the backend and in CI on
//                  pushes to protected branches (where real secrets exist).
//
//   --structural   Drift check only — no secrets needed. Asserts that
//                  backend/.env.example documents exactly the manifest
//                  (required ∪ optional) and that no deprecated names leak in.
//                  Safe to run on every PR.
//
// Unlike the previous version, this script does NOT bypass failure when
// process.env.CI is set — CI must fail fast (issue #601).

'use strict';

const fs = require('fs');
const path = require('path');
const manifest = require('./env.manifest');

const STRUCTURAL = process.argv.includes('--structural');
const EXAMPLE_PATH = path.join(__dirname, '..', '.env.example');

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

function runStructural() {
  const documented = parseEnvExampleKeys(EXAMPLE_PATH);
  const declared = new Set([...manifest.required, ...manifest.optional]);

  const missingFromExample = [...declared].filter((k) => !documented.has(k));
  const undocumentedExtras = [...documented].filter((k) => !declared.has(k));
  const deprecatedPresent = Object.keys(manifest.deprecated || {}).filter((k) =>
    documented.has(k),
  );

  const problems = [];
  if (missingFromExample.length) {
    problems.push(
      'Manifest vars missing from backend/.env.example:\n' +
        missingFromExample.map((k) => `   - ${k}`).join('\n'),
    );
  }
  if (undocumentedExtras.length) {
    problems.push(
      'Vars in backend/.env.example but not in the manifest (add them to ' +
        'backend/scripts/env.manifest.js):\n' +
        undocumentedExtras.map((k) => `   - ${k}`).join('\n'),
    );
  }
  if (deprecatedPresent.length) {
    problems.push(
      'Deprecated vars still present in backend/.env.example:\n' +
        deprecatedPresent
          .map((k) => `   - ${k} → ${manifest.deprecated[k]}`)
          .join('\n'),
    );
  }

  if (problems.length) {
    console.error('\n❌ Backend env structural check failed:\n');
    console.error(problems.join('\n\n'));
    console.error('');
    process.exit(1);
  }

  console.log('✅ Backend env manifest and .env.example are in sync.');
}

function runStrict() {
  const missing = manifest.required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('\n❌ Missing required backend environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error(
      '\nAdd them to your .env file or your deployment environment.\n' +
        'See backend/.env.example for the full list of variables.\n',
    );
    process.exit(1);
  }

  console.log('✅ All required backend environment variables are present.');
}

if (STRUCTURAL) {
  runStructural();
} else {
  runStrict();
}
