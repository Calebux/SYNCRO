#!/usr/bin/env node

/**
 * RLS Compliance Checker
 * 
 * A reliable script to verify RLS policies on all public schema tables.
 * Uses a database function for accurate RLS status checking.
 * 
 * Context: Leak prevention (Issue #14)
 * 
 * Usage:
 *   node scripts/check-rls-compliance.js
 *   
 * Environment Variables:
 *   - SUPABASE_URL: Supabase project URL  
 *   - SUPABASE_SERVICE_ROLE_KEY: Service role key for database access
 * 
 * Exit Codes:
 *   0: All tables have RLS enabled with policies
 *   1: Missing RLS policies found or script error
 */

const path = require('path');

// Handle module resolution from different directories
let supabaseModule;
try {
  supabaseModule = require('@supabase/supabase-js');
} catch (error) {
  // Try from backend directory
  try {
    supabaseModule = require('../backend/node_modules/@supabase/supabase-js');
  } catch (backendError) {
    console.error('❌ @supabase/supabase-js not found. Please install dependencies:');
    console.error('   cd backend && npm install');
    process.exit(1);
  }
}

const { createClient } = supabaseModule;

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Console colors
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m', 
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function checkRLSCompliance() {
  // Validate environment
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    log('❌ Missing required environment variables:', 'red');
    log('  - SUPABASE_URL', 'red');
    log('  - SUPABASE_SERVICE_ROLE_KEY', 'red');
    process.exit(1);
  }

  // Initialize Supabase client with service role
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  log('🔍 Starting RLS Compliance Check...', 'blue');
  log(`📊 Database: ${SUPABASE_URL}`, 'blue');
  console.log('');

  try {
    // Call the RLS audit function
    const { data, error } = await supabase.rpc('audit_rls_compliance');
    
    if (error) {
      throw new Error(`RLS audit function failed: ${error.message}`);
    }

    if (!data || data.length === 0) {
      log('⚠️  No tables found in public schema', 'yellow');
      return;
    }

    // Process results
    const issues = [];
    
    log('📋 RLS Compliance Report:', 'bold');
    log('─'.repeat(80));
    log(`${'Table Name'.padEnd(35)} ${'RLS'.padEnd(8)} ${'Policies'.padEnd(10)} Status`);
    log('─'.repeat(80));

    for (const row of data) {
      const statusColor = row.status === 'OK' ? 'green' : 'red';
      const rlsIcon = row.rls_enabled ? '✓' : '✗';
      
      console.log(
        `${row.table_name.padEnd(35)} ` +
        `${rlsIcon.padEnd(8)} ` +
        `${row.policy_count.toString().padEnd(10)} ` +
        `${colors[statusColor]}${row.status}${colors.reset}`
      );
      
      if (row.status !== 'OK') {
        issues.push(row);
      }
    }

    console.log('');

    // Summary
    const totalTables = data.length;
    const tablesWithIssues = issues.length;
    const complianceRate = ((totalTables - tablesWithIssues) / totalTables * 100).toFixed(1);

    log('📊 Summary:', 'bold');
    log(`   Total tables: ${totalTables}`);
    log(`   Tables with issues: ${tablesWithIssues}`);
    log(`   Compliance rate: ${complianceRate}%`);

    if (issues.length > 0) {
      console.log('');
      log('❌ RLS Policy Issues Found:', 'red');
      
      for (const issue of issues) {
        if (issue.status === 'MISSING_RLS') {
          log(`   ${issue.table_name}: RLS is not enabled`, 'red');
        } else if (issue.status === 'NO_POLICIES') {
          log(`   ${issue.table_name}: RLS enabled but no policies defined`, 'red');
        }
      }
      
      console.log('');
      log('🔧 To fix these issues:', 'yellow');
      log('   1. Enable RLS: ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;', 'yellow');
      log('   2. Add policies: CREATE POLICY policy_name ON table_name FOR SELECT USING (...);', 'yellow');
      log('   3. Ensure all CRUD operations have appropriate policies', 'yellow');
      
      console.log('');
      log('❌ RLS COMPLIANCE CHECK FAILED', 'red');
      log(`   ${tablesWithIssues} table(s) missing RLS policies`, 'red');
      
      process.exit(1);
    } else {
      console.log('');
      log('✅ RLS COMPLIANCE CHECK PASSED', 'green');
      log('   All tables have RLS enabled with policies', 'green');
      log('   Your database is protected against data leaks! 🔒', 'green');
    }

  } catch (error) {
    log(`❌ Compliance check failed: ${error.message}`, 'red');
    
    // If the audit function doesn't exist, provide helpful guidance
    if (error.message.includes('function') && error.message.includes('does not exist')) {
      console.log('');
      log('💡 The RLS audit function is not installed. To fix this:', 'yellow');
      log('   1. Apply the latest migrations: supabase db push', 'yellow');
      log('   2. Or manually run: supabase/migrations/20240120000000_create_rls_audit_function.sql', 'yellow');
    }
    
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  checkRLSCompliance().catch((error) => {
    log(`❌ Unexpected error: ${error.message}`, 'red');
    process.exit(1);
  });
}

module.exports = { checkRLSCompliance };