#!/usr/bin/env node

/**
 * Migration State Validator
 * 
 * Queries the database and reports applied migration state.
 * Useful for debugging, comparing across environments, and validating migration history.
 * 
 * Usage:
 *   node scripts/validate-migration-state.js                  # Against SUPABASE_URL
 *   node scripts/validate-migration-state.js --json            # JSON output
 *   node scripts/validate-migration-state.js --compare-files   # Compare with filesystem
 *   node scripts/validate-migration-state.js --env production  # Use production DB URL
 * 
 * Environment variables:
 *   SUPABASE_URL: Supabase project URL (default)
 *   SUPABASE_SERVICE_ROLE_KEY: Service role key
 *   PRODUCTION_DB_URL: Direct Postgres URL for production validation
 * 
 * Exit codes:
 *   0 - Validation successful
 *   1 - Validation issues found
 *   2 - Error occurred
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Parse arguments
const args = process.argv.slice(2);
const options = {
  json: args.includes('--json'),
  compareFiles: args.includes('--compare-files'),
  env: args.includes('--env') ? args[args.indexOf('--env') + 1] : 'default'
};

const BACKEND_MIGRATIONS = path.join(__dirname, '..', 'backend', 'migrations');
const SUPABASE_MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');

// ─────────────────────────────────────────────────────────────────────────────
// Database Query Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute SQL query via Supabase REST API
 */
async function executeQuery(query, supabaseUrl, supabaseKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const url = new URL(`${supabaseUrl}/rest/v1/rpc/exec_sql`);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Query failed: ${parsed.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Get migration history from database
 */
async function getMigrationHistory(supabaseUrl, supabaseKey) {
  try {
    const result = await executeQuery(
      `SELECT 
        name,
        executed_at,
        execution_time_ms,
        success
      FROM supabase_migrations_history 
      ORDER BY name ASC`,
      supabaseUrl,
      supabaseKey
    );
    
    return (result || []).map(row => ({
      name: row.name || row.Name || row[0],
      executedAt: row.executed_at || row.ExecutedAt || row[1],
      executionTimeMs: row.execution_time_ms || row.ExecutionTimeMs || row[2],
      success: row.success !== false && (row.Success !== false) && row[3] !== false
    }));
  } catch (err) {
    throw new Error(`Failed to fetch migration history: ${err.message}`);
  }
}

/**
 * Get database schema tables
 */
async function getDatabaseTables(supabaseUrl, supabaseKey) {
  try {
    const result = await executeQuery(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public'
       ORDER BY table_name ASC`,
      supabaseUrl,
      supabaseKey
    );
    
    return (result || []).map(row => row.table_name || row.TableName || row[0]);
  } catch (err) {
    throw new Error(`Failed to fetch database tables: ${err.message}`);
  }
}

/**
 * Read migrations from filesystem
 */
function readFilesystemMigrations() {
  const migrations = {
    backend: [],
    supabase: []
  };
  
  // Read backend migrations
  if (fs.existsSync(BACKEND_MIGRATIONS)) {
    migrations.backend = fs.readdirSync(BACKEND_MIGRATIONS)
      .filter(f => f.endsWith('.sql'))
      .sort();
  }
  
  // Read supabase migrations
  if (fs.existsSync(SUPABASE_MIGRATIONS)) {
    migrations.supabase = fs.readdirSync(SUPABASE_MIGRATIONS)
      .filter(f => f.endsWith('.sql'))
      .sort();
  }
  
  return migrations;
}

/**
 * Validate migration state
 */
async function validateMigrationState() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables required');
  }
  
  if (!options.json) {
    console.log('📊 Migration State Validator\n');
    console.log(`Environment: ${options.env}`);
    console.log(`Database: ${supabaseUrl}\n`);
  }
  
  // Fetch database state
  const appliedMigrations = await getMigrationHistory(supabaseUrl, supabaseKey);
  const tables = await getDatabaseTables(supabaseUrl, supabaseKey);
  
  const appliedNames = new Set(appliedMigrations.map(m => m.name));
  const issues = [];
  
  if (!options.json) {
    console.log('=== Database State ===\n');
    console.log(`Applied migrations: ${appliedMigrations.length}`);
    console.log(`Database tables: ${tables.length}`);
    console.log('\n--- Applied Migrations ---');
    for (const migration of appliedMigrations) {
      const status = migration.success ? '✅' : '❌';
      console.log(`${status} ${migration.name}`);
      if (migration.executedAt) {
        console.log(`   Executed: ${migration.executedAt}`);
      }
    }
  }
  
  // Compare with filesystem if requested
  if (options.compareFiles) {
    const fsRaigrations = readFilesystemMigrations();
    const allFsFiles = new Set([...fsRaigrations.backend, ...fsRaigrations.supabase]);
    
    if (!options.json) {
      console.log('\n=== Filesystem Comparison ===\n');
    }
    
    // Check for missing migrations in database
    for (const file of allFsFiles) {
      if (!appliedNames.has(file)) {
        issues.push({
          type: 'unapplied',
          severity: 'warning',
          migration: file,
          message: `Migration in filesystem but not applied to database: "${file}"`
        });
        if (!options.json) {
          console.log(`⚠️  NOT APPLIED: ${file}`);
        }
      }
    }
    
    // Check for orphaned migrations in database
    for (const migration of appliedMigrations) {
      if (!allFsFiles.has(migration.name)) {
        issues.push({
          type: 'orphaned',
          severity: 'warning',
          migration: migration.name,
          message: `Migration in database but not in filesystem: "${migration.name}"`
        });
        if (!options.json) {
          console.log(`⚠️  ORPHANED: ${migration.name}`);
        }
      }
    }
    
    if (issues.length === 0 && !options.json) {
      console.log('✅ Filesystem and database migrations are in sync');
    }
  }
  
  if (!options.json && issues.length === 0) {
    console.log('\n✅ Migration state validation successful');
  }
  
  return {
    success: true,
    appliedMigrations,
    tables,
    issues,
    environment: options.env
  };
}

/**
 * Main entry point
 */
async function main() {
  try {
    const result = await validateMigrationState();
    
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    }
    
    const hasErrors = result.issues.some(i => i.severity === 'error');
    process.exit(hasErrors ? 1 : 0);
  } catch (err) {
    if (options.json) {
      console.log(JSON.stringify({
        success: false,
        error: err.message
      }, null, 2));
    } else {
      console.error(`\n❌ Error: ${err.message}`);
    }
    process.exit(2);
  }
}

main();
