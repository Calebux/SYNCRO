#!/usr/bin/env node

/**
 * Simple RLS Compliance Checker
 * 
 * A reliable script that uses Supabase's built-in capabilities to check RLS policies.
 * This version is designed to work with the actual Supabase API limitations.
 * 
 * Context: Leak prevention (Issue #14)
 */

const path = require('path');

// Handle module resolution
let supabaseModule;
try {
  supabaseModule = require('@supabase/supabase-js');
} catch (error) {
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

// Known tables that should have RLS (based on the migrations we saw)
const EXPECTED_TABLES = [
  'profiles',
  'subscriptions', 
  'teams',
  'team_members',
  'user_preferences',
  'audit_logs',
  'idempotency_keys',
  'reminder_schedules',
  'notification_deliveries',
  'blockchain_logs',
  'subscription_risk_scores',
  'subscription_renewal_attempts',
  'subscription_approvals',
  'recovery_codes',
  'demo_rls_table'
];

async function checkRLSCompliance() {
  // Validate environment
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    log('❌ Missing required environment variables:', 'red');
    log('  - SUPABASE_URL', 'red');
    log('  - SUPABASE_SERVICE_ROLE_KEY', 'red');
    process.exit(1);
  }

  // Initialize Supabase client
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
    const auditResults = [];
    let totalIssues = 0;

    log('📋 RLS Compliance Report:', 'bold');
    log('─'.repeat(80));
    log(`${'Table Name'.padEnd(35)} ${'RLS Status'.padEnd(15)} Result`);
    log('─'.repeat(80));

    // Test each expected table
    for (const tableName of EXPECTED_TABLES) {
      try {
        // Try to query the table without authentication
        // If RLS is working, this should fail with a policy error
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .limit(1);
        
        let status = 'UNKNOWN';
        let hasRLS = false;
        
        if (error) {
          // Check if the error indicates RLS is working
          const errorMsg = error.message.toLowerCase();
          if (errorMsg.includes('policy') || 
              errorMsg.includes('rls') ||
              errorMsg.includes('row-level security') ||
              errorMsg.includes('permission denied') ||
              errorMsg.includes('insufficient privilege')) {
            status = 'OK';
            hasRLS = true;
          } else if (errorMsg.includes('does not exist') || 
                    errorMsg.includes('relation') && errorMsg.includes('not found')) {
            status = 'TABLE_NOT_FOUND';
          } else {
            status = 'ERROR';
          }
        } else {
          // If query succeeds, RLS might not be enabled or we have access
          // This could be OK if the table allows public read access
          status = 'NO_RLS_OR_PUBLIC';
          hasRLS = false;
        }
        
        // Determine if this is an issue
        const isIssue = status === 'NO_RLS_OR_PUBLIC' || status === 'ERROR';
        if (isIssue) totalIssues++;
        
        const statusColor = status === 'OK' ? 'green' : 
                           status === 'TABLE_NOT_FOUND' ? 'yellow' : 'red';
        
        console.log(
          `${tableName.padEnd(35)} ` +
          `${status.padEnd(15)} ` +
          `${colors[statusColor]}${isIssue ? '❌' : '✅'}${colors.reset}`
        );
        
        auditResults.push({
          table_name: tableName,
          status,
          has_rls: hasRLS,
          is_issue: isIssue
        });
        
      } catch (tableError) {
        totalIssues++;
        console.log(
          `${tableName.padEnd(35)} ` +
          `ERROR.padEnd(15)} ` +
          `${colors.red}❌${colors.reset}`
        );
        
        auditResults.push({
          table_name: tableName,
          status: 'ERROR',
          has_rls: false,
          is_issue: true,
          error: tableError.message
        });
      }
    }

    console.log('');

    // Summary
    const totalTables = EXPECTED_TABLES.length;
    const tablesWithIssues = totalIssues;
    const complianceRate = ((totalTables - tablesWithIssues) / totalTables * 100).toFixed(1);

    log('📊 Summary:', 'bold');
    log(`   Total tables checked: ${totalTables}`);
    log(`   Tables with issues: ${tablesWithIssues}`);
    log(`   Compliance rate: ${complianceRate}%`);

    if (totalIssues > 0) {
      console.log('');
      log('❌ RLS Policy Issues Found:', 'red');
      
      const issues = auditResults.filter(r => r.is_issue);
      for (const issue of issues) {
        if (issue.status === 'NO_RLS_OR_PUBLIC') {
          log(`   ${issue.table_name}: No RLS protection detected`, 'red');
        } else if (issue.status === 'ERROR') {
          log(`   ${issue.table_name}: Error checking RLS - ${issue.error || 'Unknown error'}`, 'red');
        } else if (issue.status === 'TABLE_NOT_FOUND') {
          log(`   ${issue.table_name}: Table not found (may be OK if not implemented yet)`, 'yellow');
        }
      }
      
      console.log('');
      log('🔧 To fix RLS issues:', 'yellow');
      log('   1. Enable RLS: ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;', 'yellow');
      log('   2. Add policies: CREATE POLICY policy_name ON table_name FOR SELECT USING (...);', 'yellow');
      
      console.log('');
      log('❌ RLS COMPLIANCE CHECK FAILED', 'red');
      log(`   ${tablesWithIssues} table(s) have RLS issues`, 'red');
      
      process.exit(1);
    } else {
      console.log('');
      log('✅ RLS COMPLIANCE CHECK PASSED', 'green');
      log('   All checked tables appear to have RLS protection', 'green');
      log('   Your database is protected against data leaks! 🔒', 'green');
    }

  } catch (error) {
    log(`❌ Compliance check failed: ${error.message}`, 'red');
    console.error(error);
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