#!/usr/bin/env node

/**
 * RLS Policy Audit Script
 * 
 * This script programmatically verifies that EVERY table in the public schema
 * has Row Level Security (RLS) enabled with active policies.
 * 
 * Context: Leak prevention (Issue #14)
 * 
 * Usage:
 *   node scripts/audit-rls-policies.js
 *   
 * Environment Variables:
 *   - SUPABASE_URL: Supabase project URL
 *   - SUPABASE_SERVICE_ROLE_KEY: Service role key for database access
 *   - DATABASE_URL: Direct PostgreSQL connection string (alternative to Supabase)
 * 
 * Exit Codes:
 *   0: All tables have RLS enabled with policies
 *   1: Missing RLS policies found or script error
 */

const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Color codes for console output
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

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

async function auditRLSPolicies() {
  // Validate environment variables
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    logError('Missing required environment variables:');
    logError('  - SUPABASE_URL');
    logError('  - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // Initialize Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  logInfo('Starting RLS Policy Audit...');
  logInfo(`Database: ${SUPABASE_URL}`);

  try {
    // Query to get all tables in public schema with their RLS status
    const { data: tables, error: tablesError } = await supabase.rpc('audit_rls_policies_check', {});
    
    if (tablesError) {
      // If the function doesn't exist, create it and try again
      logInfo('Creating audit function...');
      
      const createFunctionQuery = `
        CREATE OR REPLACE FUNCTION audit_rls_policies_check()
        RETURNS TABLE(
          table_name TEXT,
          rls_enabled BOOLEAN,
          policy_count INTEGER,
          status TEXT
        ) AS $$
        DECLARE
          rec RECORD;
        BEGIN
          FOR rec IN 
            SELECT t.table_name
            FROM information_schema.tables t
            WHERE t.table_schema = 'public'
              AND t.table_type = 'BASE TABLE'
              AND t.table_name NOT LIKE 'pg_%'
              AND t.table_name NOT LIKE 'sql_%'
            ORDER BY t.table_name
          LOOP
            SELECT 
              rec.table_name,
              c.relrowsecurity as rls_enabled,
              COALESCE(p.policy_count, 0) as policy_count,
              CASE 
                WHEN NOT c.relrowsecurity THEN 'MISSING_RLS'
                WHEN COALESCE(p.policy_count, 0) = 0 THEN 'NO_POLICIES'
                ELSE 'OK'
              END as status
            INTO 
              table_name,
              rls_enabled, 
              policy_count,
              status
            FROM pg_class c
            LEFT JOIN (
              SELECT 
                schemaname || '.' || tablename as full_table_name,
                COUNT(*) as policy_count
              FROM pg_policies 
              WHERE schemaname = 'public'
              GROUP BY schemaname, tablename
            ) p ON p.full_table_name = 'public.' || rec.table_name
            WHERE c.relname = rec.table_name
              AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
            
            RETURN NEXT;
          END LOOP;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
      `;
      
      const { error: createError } = await supabase.rpc('exec_sql', { 
        sql: createFunctionQuery 
      });
      
      if (createError) {
        // Try direct SQL execution
        const { error: directError } = await supabase
          .from('_dummy_')
          .select('*')
          .limit(0);
        
        // Use alternative approach with direct queries
        return await auditRLSPoliciesAlternative(supabase);
      }
      
      // Retry the audit function
      const { data: retryData, error: retryError } = await supabase.rpc('audit_rls_policies_check', {});
      
      if (retryError) {
        throw retryError;
      }
      
      return await processAuditResults(retryData);
    }
    
    return await processAuditResults(tables);
    
  } catch (error) {
    logError(`Audit failed: ${error.message}`);
    
    // Try alternative approach
    logInfo('Trying alternative audit method...');
    return await auditRLSPoliciesAlternative(supabase);
  }
}

async function auditRLSPoliciesAlternative(supabase) {
  try {
    // Get all tables in public schema
    const { data: tablesData, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_type', 'BASE TABLE')
      .not('table_name', 'like', 'pg_%')
      .not('table_name', 'like', 'sql_%')
      .order('table_name');

    if (tablesError) {
      throw new Error(`Failed to fetch tables: ${tablesError.message}`);
    }

    // Get RLS status for each table
    const auditResults = [];
    
    for (const table of tablesData) {
      try {
        // Check RLS status using pg_class
        const { data: rlsData, error: rlsError } = await supabase
          .rpc('check_table_rls', { table_name: table.table_name });
        
        if (rlsError) {
          // Manual check - try to query the table to see if RLS is enforced
          const { error: queryError } = await supabase
            .from(table.table_name)
            .select('*')
            .limit(1);
          
          // If we get a policy violation, RLS is enabled
          const hasRLS = queryError && queryError.message.includes('policy');
          
          auditResults.push({
            table_name: table.table_name,
            rls_enabled: hasRLS,
            policy_count: hasRLS ? 1 : 0, // Assume at least 1 policy if RLS blocks access
            status: hasRLS ? 'OK' : 'MISSING_RLS'
          });
        } else {
          auditResults.push(rlsData);
        }
      } catch (tableError) {
        logWarning(`Could not check RLS for table ${table.table_name}: ${tableError.message}`);
        auditResults.push({
          table_name: table.table_name,
          rls_enabled: false,
          policy_count: 0,
          status: 'UNKNOWN'
        });
      }
    }
    
    return await processAuditResults(auditResults);
    
  } catch (error) {
    logError(`Alternative audit failed: ${error.message}`);
    process.exit(1);
  }
}

async function processAuditResults(auditResults) {
  if (!auditResults || auditResults.length === 0) {
    logWarning('No tables found in public schema');
    return;
  }

  logInfo(`Found ${auditResults.length} tables in public schema`);
  console.log('');

  // Display results
  const issues = [];
  
  log('Table RLS Audit Results:', 'bold');
  log('─'.repeat(80));
  log(`${'Table Name'.padEnd(30)} ${'RLS Enabled'.padEnd(12)} ${'Policies'.padEnd(10)} Status`);
  log('─'.repeat(80));

  for (const result of auditResults) {
    const statusColor = result.status === 'OK' ? 'green' : 'red';
    const rlsStatus = result.rls_enabled ? '✓' : '✗';
    const policyCount = result.policy_count || 0;
    
    console.log(
      `${result.table_name.padEnd(30)} ` +
      `${rlsStatus.padEnd(12)} ` +
      `${policyCount.toString().padEnd(10)} ` +
      `${colors[statusColor]}${result.status}${colors.reset}`
    );
    
    if (result.status !== 'OK') {
      issues.push({
        table: result.table_name,
        issue: result.status,
        rls_enabled: result.rls_enabled,
        policy_count: result.policy_count
      });
    }
  }

  console.log('');

  // Summary
  const totalTables = auditResults.length;
  const tablesWithIssues = issues.length;
  const complianceRate = ((totalTables - tablesWithIssues) / totalTables * 100).toFixed(1);

  log('RLS Audit Summary:', 'bold');
  log(`  Total tables: ${totalTables}`);
  log(`  Tables with issues: ${tablesWithIssues}`);
  log(`  Compliance rate: ${complianceRate}%`);

  if (issues.length > 0) {
    console.log('');
    logError('RLS Policy Issues Found:');
    
    for (const issue of issues) {
      if (issue.issue === 'MISSING_RLS') {
        logError(`  ${issue.table}: RLS is not enabled`);
      } else if (issue.issue === 'NO_POLICIES') {
        logError(`  ${issue.table}: RLS enabled but no policies defined`);
      } else {
        logError(`  ${issue.table}: ${issue.issue}`);
      }
    }
    
    console.log('');
    logError('RLS AUDIT FAILED: Some tables are missing RLS policies');
    logError('');
    logError('To fix these issues:');
    logError('1. Enable RLS: ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;');
    logError('2. Add policies: CREATE POLICY policy_name ON table_name FOR SELECT USING (...);');
    logError('3. Ensure all CRUD operations have appropriate policies');
    
    process.exit(1);
  } else {
    console.log('');
    logSuccess('RLS AUDIT PASSED: All tables have RLS enabled with policies');
    logSuccess('Your database is protected against data leaks! 🔒');
  }
}

// Run the audit
if (require.main === module) {
  auditRLSPolicies().catch((error) => {
    logError(`Unexpected error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { auditRLSPolicies };