#!/usr/bin/env node

/**
 * Migration Drift Check Script
 *
 * Detects drift between migration files and database schema state.
 *
 * Usage:
 *   node scripts/check-migration-drift.js                             # File-only check
 *   node scripts/check-migration-drift.js --verify-db                 # File + migration history
 *   node scripts/check-migration-drift.js --verify-schema             # File + live schema objects
 *   node scripts/check-migration-drift.js --verify-db --verify-schema # Full local/remote check
 *   node scripts/check-migration-drift.js --compare-schema FILE --live-schema FILE
 *   node scripts/check-migration-drift.js --json --strict             # CI mode
 *
 * Environment variables:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — migration history via REST
 *   DATABASE_URL                             — schema introspection via psql (default: local Supabase)
 *
 * Exit codes:
 *   0 - No drift detected
 *   1 - Drift detected
 *   2 - Error occurred
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const https = require('https');
const http = require('http');

const SUPABASE_MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');
const CLIENT_MIGRATIONS = path.join(__dirname, '..', 'client', 'supabase', 'migrations');
const BACKEND_MIGRATIONS = path.join(__dirname, '..', 'backend', 'migrations');
const SCHEMA_SNAPSHOT = path.join(__dirname, '..', 'supabase', 'schema.snapshot.sql');
const DEFAULT_LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const IGNORED_LIVE_TABLES = new Set([
  'schema_migrations',
]);

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
const compareSchemaIdx = args.indexOf('--compare-schema');
const liveSchemaIdx = args.indexOf('--live-schema');

const options = {
  verifyDb: args.includes('--verify-db'),
  verifySchema: args.includes('--verify-schema'),
  json: args.includes('--json'),
  strict: args.includes('--strict'),
  env: envIdx >= 0 && args[envIdx + 1] ? args[envIdx + 1] : 'unknown',
  compareSchema: compareSchemaIdx >= 0 && args[compareSchemaIdx + 1] ? args[compareSchemaIdx + 1] : null,
  liveSchema: liveSchemaIdx >= 0 && args[liveSchemaIdx + 1] ? args[liveSchemaIdx + 1] : null,
};

function severity(level) {
  if (level === 'error') return 'error';
  return options.strict ? 'error' : 'warning';
}

function migrationVersion(filename) {
  const match = filename.match(/^(\d+)/);
  return match ? match[1] : filename.replace(/\.sql$/, '');
}

function normalizeSQL(content) {
  return content
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\bpublic\./g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function normalizeSchemaSnapshot(content) {
  return content
    .replace(/^\\restrict.*$/gm, '')
    .replace(/^\\unrestrict.*$/gm, '')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function extractTables(sql) {
  const tableRegex = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi;
  const alterRegex = /alter\s+table\s+(?:only\s+)?(?:public\.)?(\w+)/gi;
  const tables = new Set();

  let match;
  while ((match = tableRegex.exec(sql)) !== null) {
    tables.add(match[1].toLowerCase());
  }
  while ((match = alterRegex.exec(sql)) !== null) {
    tables.add(match[1].toLowerCase());
  }

  return tables;
}

function extractIndexes(sql) {
  const indexRegex = /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)/gi;
  const indexes = new Set();

  let match;
  while ((match = indexRegex.exec(sql)) !== null) {
    indexes.add(match[1].toLowerCase());
  }

  return indexes;
}

function extractPolicies(sql) {
  const policyRegex = /create\s+policy\s+(\w+)/gi;
  const policies = new Set();

  let match;
  while ((match = policyRegex.exec(sql)) !== null) {
    policies.add(match[1].toLowerCase());
  }

  return policies;
}

function readMigrations(dir) {
  const migrations = new Map();

  if (!fs.existsSync(dir)) {
    return migrations;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    migrations.set(file, {
      content,
      normalized: normalizeSQL(content),
      tables: extractTables(content),
      indexes: extractIndexes(content),
      policies: extractPolicies(content),
      version: migrationVersion(file),
    });
  }

  return migrations;
}

function readActiveBackendMigrations() {
  const migrations = new Map();
  if (!fs.existsSync(BACKEND_MIGRATIONS)) {
    return migrations;
  }

  const files = fs.readdirSync(BACKEND_MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const content = fs.readFileSync(path.join(BACKEND_MIGRATIONS, file), 'utf-8');
    migrations.set(file, {
      content,
      normalized: normalizeSQL(content),
      tables: extractTables(content),
      indexes: extractIndexes(content),
      policies: extractPolicies(content),
      version: migrationVersion(file),
    });
  }

  return migrations;
}

function compareMigrations(name1, m1, name2, m2) {
  const issues = [];

  if (m1.normalized === m2.normalized) {
    issues.push({
      type: 'duplicate',
      severity: 'error',
      message: `Identical migrations: "${name1}" and "${name2}"`,
      files: [name1, name2],
    });
  } else {
    const commonTables = [...m1.tables].filter(t => m2.tables.has(t));
    if (commonTables.length > 0) {
      issues.push({
        type: 'conflict',
        severity: severity('warning'),
        message: `Common tables in different migrations: "${name1}" and "${name2}" affect tables: ${commonTables.join(', ')}`,
        files: [name1, name2],
        tables: commonTables,
      });
    }
  }

  return issues;
}

function detectTimestampConflicts(migrations) {
  const byTimestamp = new Map();
  const issues = [];

  for (const [file, data] of migrations) {
    const ts = data.version;
    if (!byTimestamp.has(ts)) {
      byTimestamp.set(ts, []);
    }
    byTimestamp.get(ts).push(file);
  }

  for (const [ts, files] of byTimestamp) {
    if (files.length > 1) {
      issues.push({
        type: 'timestamp_conflict',
        severity: 'error',
        message: `Conflicting migration timestamp "${ts}" used by ${files.length} files: ${files.join(', ')}`,
        files,
        timestamp: ts,
      });
    }
  }

  return issues;
}

function detectClientMigrationDrift(canonicalMigrations) {
  const clientMigrations = readMigrations(CLIENT_MIGRATIONS);
  const issues = [];

  if (clientMigrations.size === 0) {
    return issues;
  }

  for (const [clientFile, clientData] of clientMigrations) {
    let matchedCanonical = false;

    for (const [canonFile, canonData] of canonicalMigrations) {
      if (clientData.normalized === canonData.normalized) {
        matchedCanonical = true;
        issues.push({
          type: 'duplicate',
          severity: 'error',
          message: `Client migration duplicates canonical migration: "${clientFile}" matches "${canonFile}" — remove client/supabase/migrations copy`,
          files: [clientFile, canonFile],
        });
      }
    }

    if (!matchedCanonical) {
      const clientStem = clientFile.replace(/^\d+_?/, '').replace(/\.sql$/, '');
      const hasSimilarCanonical = [...canonicalMigrations.keys()].some((name) => {
        const canonStem = name.replace(/^\d+_?/, '').replace(/\.sql$/, '');
        return canonStem === clientStem || name.includes(clientStem) || clientStem.includes(canonStem);
      });

      if (!hasSimilarCanonical) {
        issues.push({
          type: 'stale_client_migration',
          severity: 'error',
          message: `Stale client migration not represented in supabase/migrations: "${clientFile}"`,
          files: [clientFile],
        });
      }
    }
  }

  return issues;
}

function collectExpectedSchema(migrations) {
  const tables = new Set();
  const indexes = new Set();
  const policies = new Set();

  for (const [, data] of migrations) {
    for (const table of data.tables) tables.add(table);
    for (const index of data.indexes) indexes.add(index);
    for (const policy of data.policies) policies.add(policy);
  }

  return { tables, indexes, policies };
}

function queryPg(dbUrl, sql) {
  try {
    const output = execFileSync(
      'psql',
      [dbUrl, '-t', '-A', '-c', sql],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.trim() ? output.trim().split('\n').filter(Boolean) : [];
  } catch (err) {
    const detail = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`psql query failed: ${detail}`);
  }
}

function getLiveSchema(dbUrl) {
  const tables = queryPg(
    dbUrl,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const indexes = queryPg(
    dbUrl,
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname"
  );

  return {
    tables: new Set(tables.map(t => t.toLowerCase()).filter(t => !IGNORED_LIVE_TABLES.has(t))),
    indexes: new Set(indexes.map(i => i.toLowerCase())),
  };
}

function buildSchemaDiffReport(expected, actual) {
  const lines = [];

  const missingTables = [...expected.tables].filter(t => !actual.tables.has(t)).sort();
  const extraTables = [...actual.tables].filter(t => !expected.tables.has(t)).sort();
  const missingIndexes = [...expected.indexes].filter(i => !actual.indexes.has(i)).sort();
  const extraIndexes = [...actual.indexes].filter(i => !expected.indexes.has(i)).sort();

  if (missingTables.length > 0) {
    lines.push('Tables expected from migrations but missing in database:');
    for (const table of missingTables) lines.push(`  - ${table}`);
  }
  if (extraTables.length > 0) {
    lines.push('Tables in database but not defined in migration files (missing migration?):');
    for (const table of extraTables) lines.push(`  + ${table}`);
  }
  if (missingIndexes.length > 0) {
    lines.push('Indexes expected from migrations but missing in database:');
    for (const index of missingIndexes) lines.push(`  - ${index}`);
  }
  if (extraIndexes.length > 0) {
    lines.push('Indexes in database but not defined in migration files:');
    for (const index of extraIndexes) lines.push(`  + ${index}`);
  }

  return lines.join('\n');
}

function compareSchemaObjects(expected, actual) {
  const issues = [];
  const diffReport = buildSchemaDiffReport(expected, actual);

  for (const table of expected.tables) {
    if (!actual.tables.has(table)) {
      issues.push({
        type: 'schema_drift',
        severity: 'error',
        message: `Table "${table}" defined in migrations but missing from database schema`,
        object: table,
        objectType: 'table',
      });
    }
  }

  for (const table of actual.tables) {
    if (!expected.tables.has(table)) {
      issues.push({
        type: 'schema_drift',
        severity: 'error',
        message: `Table "${table}" exists in database but not defined in migration files (missing migration?)`,
        object: table,
        objectType: 'table',
      });
    }
  }

  for (const index of expected.indexes) {
    if (!actual.indexes.has(index)) {
      issues.push({
        type: 'schema_drift',
        severity: severity('warning'),
        message: `Index "${index}" defined in migrations but missing from database schema`,
        object: index,
        objectType: 'index',
      });
    }
  }

  return { issues, diffReport: diffReport || null };
}

function compareSchemaSnapshotFiles(expectedPath, livePath) {
  if (!fs.existsSync(expectedPath)) {
    return {
      success: true,
      skipped: true,
      reason: `Schema snapshot not found at ${expectedPath}`,
    };
  }
  if (!fs.existsSync(livePath)) {
    return {
      success: false,
      error: `Live schema dump not found at ${livePath}`,
    };
  }

  const expected = normalizeSchemaSnapshot(fs.readFileSync(expectedPath, 'utf8'));
  const live = normalizeSchemaSnapshot(fs.readFileSync(livePath, 'utf8'));

  if (expected === live) {
    return { success: true, skipped: false };
  }

  return {
    success: false,
    skipped: false,
    diffReport: 'Committed schema.snapshot.sql does not match live database schema after applying migrations.',
    expectedPath,
    livePath,
  };
}

async function fetchAppliedMigrationVersions(supabaseUrl, supabaseKey) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${supabaseUrl}/rest/v1/supabase_migrations?select=version,name&order=version.asc`);
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Failed to fetch supabase_migrations (${res.statusCode}): ${data}`));
          return;
        }
        try {
          const rows = JSON.parse(data);
          resolve(rows.map(row => ({
            version: row.version,
            name: row.name || row.version,
          })));
        } catch {
          reject(new Error(`Failed to parse supabase_migrations response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function mapFilesystemMigrations(migrations) {
  const byVersion = new Map();
  for (const [file, data] of migrations) {
    byVersion.set(data.version, file);
  }
  return byVersion;
}

function detectDrift() {
  if (!options.json) {
    console.log(`🔍 Checking migration drift... [env: ${options.env}]\n`);
  }

  const supabaseMigrations = readMigrations(SUPABASE_MIGRATIONS);
  const backendMigrations = readActiveBackendMigrations();
  const issues = [];

  issues.push(...detectTimestampConflicts(supabaseMigrations));
  issues.push(...detectClientMigrationDrift(supabaseMigrations));

  if (backendMigrations.size > 0) {
    issues.push({
      type: 'backend_migration',
      severity: 'error',
      message: `Active SQL migrations found in backend/migrations/ (${backendMigrations.size} file(s)). Use supabase/migrations/ only.`,
      files: [...backendMigrations.keys()],
    });
  }

  const analyzed = new Set();
  for (const [fileA, dataA] of supabaseMigrations) {
    for (const [fileB, dataB] of supabaseMigrations) {
      if (fileA >= fileB) continue;
      const pairKey = [fileA, fileB].sort().join('|');
      if (analyzed.has(pairKey)) continue;
      analyzed.add(pairKey);
      issues.push(...compareMigrations(fileA, dataA, fileB, dataB));
    }
  }

  const allSupabaseTables = new Map();
  for (const [file, data] of supabaseMigrations) {
    for (const table of data.tables) {
      if (!allSupabaseTables.has(table)) allSupabaseTables.set(table, []);
      allSupabaseTables.get(table).push(file);
    }
  }

  if (!options.json) {
    console.log('=== Migration Analysis ===\n');
    console.log(`Supabase migrations: ${supabaseMigrations.size} files`);
    if (backendMigrations.size > 0) {
      console.log(`Backend migrations (forbidden): ${backendMigrations.size} files`);
    }
    console.log('');
  }

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (!options.json) {
    if (issues.length === 0) {
      console.log('✅ No migration file drift detected.');
      console.log(`Total supabase tables referenced: ${allSupabaseTables.size}`);
    } else {
      if (errors.length > 0) {
        console.log('❌ ERRORS (must fix):\n');
        for (const issue of errors) console.log(`  [${issue.type.toUpperCase()}] ${issue.message}`);
        console.log('');
      }
      if (warnings.length > 0) {
        console.log('⚠️  WARNINGS:\n');
        for (const issue of warnings) console.log(`  [${issue.type.toUpperCase()}] ${issue.message}`);
        console.log('');
      }
    }
  }

  return {
    success: errors.length === 0,
    issues,
    fileCheck: {
      supabaseCount: supabaseMigrations.size,
      backendCount: backendMigrations.size,
      supabaseTableCount: allSupabaseTables.size,
      errors: errors.length,
      warnings: warnings.length,
    },
    supabaseMigrations,
  };
}

async function verifyDatabaseState(supabaseMigrations) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    const msg = 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for --verify-db';
    if (options.strict) {
      throw new Error(msg);
    }
    return { success: false, error: msg, dbCheck: null };
  }

  const applied = await fetchAppliedMigrationVersions(supabaseUrl, supabaseKey);
  const appliedVersions = new Set(applied.map(row => row.version));
  const filesystemByVersion = mapFilesystemMigrations(supabaseMigrations);
  const dbIssues = [];

  for (const row of applied) {
    if (!filesystemByVersion.has(row.version)) {
      dbIssues.push({
        type: 'orphaned_migration',
        severity: severity('warning'),
        message: `Migration version "${row.version}" applied in database but no matching file in supabase/migrations/`,
        migration: row.name || row.version,
        version: row.version,
      });
    }
  }

  for (const [version, file] of filesystemByVersion) {
    if (!appliedVersions.has(version)) {
      dbIssues.push({
        type: 'unapplied_migration',
        severity: severity('warning'),
        message: `Migration "${file}" exists in filesystem but is not applied to database`,
        migration: file,
        version,
      });
    }
  }

  if (!options.json) {
    if (dbIssues.length === 0) {
      console.log('✅ Database migration history matches filesystem.');
      console.log(`Applied migrations: ${applied.length}`);
    } else {
      console.log('\n=== Database Migration History Issues ===\n');
      for (const issue of dbIssues) console.log(`  [${issue.type.toUpperCase()}] ${issue.message}`);
    }
  }

  return {
    success: dbIssues.filter(i => i.severity === 'error').length === 0,
    dbCheck: {
      appliedCount: applied.length,
      filesystemCount: filesystemByVersion.size,
      issues: dbIssues,
      appliedMigrations: applied,
    },
  };
}

async function verifySchemaState(supabaseMigrations) {
  const dbUrl = process.env.DATABASE_URL || DEFAULT_LOCAL_DB_URL;
  const expected = collectExpectedSchema(supabaseMigrations);
  const actual = getLiveSchema(dbUrl);
  const { issues, diffReport } = compareSchemaObjects(expected, actual);

  if (!options.json) {
    if (issues.length === 0) {
      console.log('✅ Live database schema matches migration SQL expectations.');
    } else {
      console.log('\n=== Schema Drift ===\n');
      if (diffReport) console.log(diffReport);
      console.log('');
      for (const issue of issues) console.log(`  [${issue.type.toUpperCase()}] ${issue.message}`);
    }
  }

  return {
    success: issues.filter(i => i.severity === 'error').length === 0,
    schemaCheck: {
      dbUrl: dbUrl.replace(/:[^:@/]+@/, ':***@'),
      expectedTableCount: expected.tables.size,
      liveTableCount: actual.tables.size,
      expectedIndexCount: expected.indexes.size,
      liveIndexCount: actual.indexes.size,
      issues,
      diffReport,
    },
  };
}

async function verifySchemaSnapshot() {
  if (!options.compareSchema && !options.liveSchema) {
    if (fs.existsSync(SCHEMA_SNAPSHOT) && options.verifySchema) {
      return { success: true, schemaSnapshotCheck: { skipped: true, reason: 'No live schema dump provided' } };
    }
    return null;
  }

  const expectedPath = options.compareSchema || SCHEMA_SNAPSHOT;
  const livePath = options.liveSchema;
  const result = compareSchemaSnapshotFiles(expectedPath, livePath);

  if (!options.json && !result.skipped && !result.success) {
    console.log('\n=== Schema Snapshot Diff ===\n');
    console.log(result.diffReport || result.error);
  }

  return {
    success: result.success,
    schemaSnapshotCheck: result,
  };
}

async function main() {
  try {
    const fileCheckResult = detectDrift();
    let dbCheckResult = null;
    let schemaCheckResult = null;
    let schemaSnapshotResult = null;

    if (options.verifyDb) {
      dbCheckResult = await verifyDatabaseState(fileCheckResult.supabaseMigrations);
    }

    if (options.verifySchema) {
      schemaCheckResult = await verifySchemaState(fileCheckResult.supabaseMigrations);
    }

    if (options.compareSchema || options.liveSchema) {
      schemaSnapshotResult = await verifySchemaSnapshot();
    }

    const allIssues = [
      ...fileCheckResult.issues,
      ...(dbCheckResult?.dbCheck?.issues || []),
      ...(schemaCheckResult?.schemaCheck?.issues || []),
    ];

    if (schemaSnapshotResult && !schemaSnapshotResult.success && !schemaSnapshotResult.schemaSnapshotCheck?.skipped) {
      allIssues.push({
        type: 'schema_snapshot_drift',
        severity: 'error',
        message: schemaSnapshotResult.schemaSnapshotCheck.diffReport
          || schemaSnapshotResult.schemaSnapshotCheck.error
          || 'Schema snapshot does not match live database',
      });
    }

    const fileSuccess = fileCheckResult.success;
    const dbSuccess = dbCheckResult ? dbCheckResult.success : true;
    const schemaSuccess = schemaCheckResult ? schemaCheckResult.success : true;
    const snapshotSuccess = schemaSnapshotResult ? schemaSnapshotResult.success : true;
    const overallSuccess = fileSuccess && dbSuccess && schemaSuccess && snapshotSuccess;

    const diffReport = [
      schemaCheckResult?.schemaCheck?.diffReport,
      schemaSnapshotResult?.schemaSnapshotCheck?.diffReport,
    ].filter(Boolean).join('\n\n') || null;

    if (options.json) {
      console.log(JSON.stringify({
        success: overallSuccess,
        env: options.env,
        strict: options.strict,
        fileCheck: fileCheckResult.fileCheck,
        dbCheck: dbCheckResult?.dbCheck || null,
        schemaCheck: schemaCheckResult?.schemaCheck || null,
        schemaSnapshotCheck: schemaSnapshotResult?.schemaSnapshotCheck || null,
        issues: allIssues,
        diffReport,
      }, null, 2));
    } else if (!overallSuccess) {
      console.log('\n❌ Migration drift detected! See docs/MIGRATION_REMEDIATION.md');
      if (diffReport) {
        console.log('\n--- Schema Diff ---\n');
        console.log(diffReport);
      }
    }

    process.exit(overallSuccess ? 0 : 1);
  } catch (err) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: err.message }, null, 2));
    } else {
      console.error(`\n❌ Error: ${err.message}`);
    }
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizeSQL,
  normalizeSchemaSnapshot,
  extractTables,
  extractIndexes,
  extractPolicies,
  migrationVersion,
  detectTimestampConflicts,
  compareMigrations,
  collectExpectedSchema,
  compareSchemaObjects,
  buildSchemaDiffReport,
  compareSchemaSnapshotFiles,
  readMigrations,
};
