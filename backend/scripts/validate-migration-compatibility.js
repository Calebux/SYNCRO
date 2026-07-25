#!/usr/bin/env node
/**
 * Migration Compatibility Validator for Blue-Green Deployments
 *
 * Checks pending migrations for patterns that break the old (green) slot
 * while the new (blue) slot is live:
 *
 *   BLOCKING (exit 1):
 *     - DROP TABLE / DROP COLUMN / TRUNCATE  → old slot loses data immediately
 *     - RENAME COLUMN / RENAME TABLE         → old slot queries break
 *     - ADD COLUMN NOT NULL without DEFAULT  → old slot inserts fail
 *
 *   WARNINGS (non-blocking):
 *     - Non-concurrent INDEX creation        → table lock during deploy
 *     - Adding UNIQUE/FK constraints         → potential lock contention
 *
 * Usage:
 *   node backend/scripts/validate-migration-compatibility.js
 *
 * Exit codes: 0 = OK, 1 = incompatible migrations, 2 = script error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

const BLOCKING = [
  { re: /\bDROP\s+TABLE\b/i,         label: 'DROP TABLE' },
  { re: /\bDROP\s+COLUMN\b/i,        label: 'DROP COLUMN' },
  { re: /\bTRUNCATE\b/i,             label: 'TRUNCATE' },
  { re: /\bRENAME\s+COLUMN\b/i,      label: 'RENAME COLUMN' },
  { re: /\bRENAME\s+TO\b/i,          label: 'RENAME TABLE' },
  // NOT NULL without DEFAULT breaks inserts from the old slot
  { re: /ADD\s+COLUMN\s+\S+\s+\S+\s+NOT\s+NULL(?!\s+DEFAULT)/i, label: 'ADD COLUMN NOT NULL (no DEFAULT)' },
];

const WARNINGS = [
  { re: /CREATE\s+(?!.*CONCURRENTLY)INDEX\b/i,                     label: 'Non-concurrent INDEX (use CONCURRENTLY)' },
  { re: /ADD\s+(UNIQUE|FOREIGN\s+KEY|PRIMARY\s+KEY)\s+CONSTRAINT/i, label: 'Constraint addition (may lock table)' },
];

async function getAppliedVersions() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return new Promise((resolve) => {
    const parsed = new URL(`${url}/rest/v1/supabase_migrations?select=version`);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(new Set(JSON.parse(data).map(r => r.version))); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('ℹ️  No migrations directory — nothing to validate');
    process.exit(0);
  }

  const applied = await getAppliedVersions();
  if (applied) console.log(`📡 ${applied.size} migrations already applied in DB`);
  else console.log('ℹ️  DB unreachable or creds missing — validating all files');

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  const issues = [], warnings = [];

  for (const file of files) {
    if (applied?.has(file.replace('.sql', ''))) continue; // already applied — skip

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    for (const { re, label } of BLOCKING) {
      if (re.test(sql)) issues.push({ file, label });
    }
    for (const { re, label } of WARNINGS) {
      if (re.test(sql)) warnings.push({ file, label });
    }
  }

  if (warnings.length) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(w => console.log(`   [${w.file}] ${w.label}`));
  }

  if (issues.length) {
    console.log('\n❌ Incompatible migrations (deploy blocked):');
    issues.forEach(i => console.log(`   [${i.file}] ${i.label}`));
    console.log('\nFix: split the migration or add a backwards-compatible step first.\n');
    process.exit(1);
  }

  console.log(`\n✅ All pending migrations are blue-green compatible (${files.length} files checked)\n`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(2); });
