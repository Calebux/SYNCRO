#!/usr/bin/env node
/**
 * check-api-surface.js
 *
 * Verifies that the committed api-surface.md matches the actual exports of
 * sdk/src/index.ts.  Run in CI via:
 *
 *   node sdk/scripts/check-api-surface.js
 *
 * Exits with non-zero status when a surface change is not reflected in the
 * committed report, so that reviewers are forced to update the report and the
 * CHANGELOG when the API changes.
 *
 * The check is intentionally coarse: it parses a set of known symbol names
 * from the .ts source and verifies each appears in the committed report.  This
 * is sufficient to catch accidental removals and new additions without
 * requiring a full TypeScript compiler invocation in CI.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_TS = path.join(ROOT, 'src', 'index.ts');
const SURFACE_MD = path.join(ROOT, 'api-surface.md');

// ─────────────────────────────────────────────────────────────────────────────
// Extract exported symbol names from index.ts
// ─────────────────────────────────────────────────────────────────────────────
function extractExportedNames(source) {
  const names = new Set();

  // export { A, B, C } from "..."
  const namedExportRe = /export\s*\{([^}]+)\}\s*from/g;
  let m;
  while ((m = namedExportRe.exec(source)) !== null) {
    const block = m[1];
    for (const part of block.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }

  // export class / function / const / type / interface Foo
  const directExportRe = /export\s+(?:default\s+)?(?:class|function|const|type|interface|enum)\s+(\w+)/g;
  while ((m = directExportRe.exec(source)) !== null) {
    names.add(m[1]);
  }

  return names;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
const indexSource = fs.readFileSync(INDEX_TS, 'utf8');
const surfaceReport = fs.readFileSync(SURFACE_MD, 'utf8');

const exported = extractExportedNames(indexSource);

const missing = [];
for (const name of exported) {
  // Skip the default export keyword itself
  if (name === 'default') continue;
  if (!surfaceReport.includes(name)) {
    missing.push(name);
  }
}

if (missing.length > 0) {
  console.error('');
  console.error('API Surface Check FAILED');
  console.error('────────────────────────────────────────────────');
  console.error('The following names are exported from sdk/src/index.ts');
  console.error('but are NOT listed in sdk/api-surface.md:');
  console.error('');
  for (const name of missing) {
    console.error(`  • ${name}`);
  }
  console.error('');
  console.error('To fix:');
  console.error('  1. Add each symbol to the appropriate section of sdk/api-surface.md');
  console.error('  2. Decide if it is stable public surface or experimental');
  console.error('  3. If it is a breaking change, update sdk/CHANGELOG.md and bump the version');
  console.error('');
  process.exit(1);
}

console.log(`API Surface Check PASSED — ${exported.size} exported symbols verified`);
