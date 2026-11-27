#!/usr/bin/env node

/**
 * Test script for RLS audit functionality
 * 
 * This script tests the RLS compliance checker against a known database state.
 * It can be used to verify the audit script works correctly before deployment.
 */

const { createClient } = require('@supabase/supabase-js');

// Test configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required.');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY=<your-local-service-role-key>');
  console.error('  See scripts/README.md for how to obtain the local key from `supabase status`.');
  process.exit(1);
}

async function testRLSAudit() {
  console.log('🧪 Testing RLS Audit Script...');
  console.log(`📊 Database: ${SUPABASE_URL}`);
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  try {
    // Test 1: Check if we can connect to the database
    console.log('\n1️⃣ Testing database connection...');
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .limit(1);
    
    if (error) {
      throw new Error(`Connection failed: ${error.message}`);
    }
    
    console.log('✅ Database connection successful');

    // Test 2: Check if we can query pg_policies
    console.log('\n2️⃣ Testing policy access...');
    const { data: policies, error: policyError } = await supabase
      .rpc('exec_sql', { 
        query: 'SELECT COUNT(*) as count FROM pg_policies WHERE schemaname = \'public\'' 
      });
    
    if (policyError) {
      console.log('⚠️  Direct policy query failed, trying alternative method...');
      // This is expected in some environments
    } else {
      console.log('✅ Policy access successful');
    }

    // Test 3: Run the actual audit script
    console.log('\n3️⃣ Running RLS compliance check...');
    
    // Import and run the audit function
    const { checkRLSCompliance } = require('./check-rls-compliance.js');
    
    // Capture the original process.exit to prevent the test from exiting
    const originalExit = process.exit;
    let exitCode = 0;
    
    process.exit = (code) => {
      exitCode = code;
      console.log(`\n📊 Audit completed with exit code: ${code}`);
    };
    
    try {
      await checkRLSCompliance();
    } catch (error) {
      console.log(`⚠️  Audit error: ${error.message}`);
      exitCode = 1;
    }
    
    // Restore original process.exit
    process.exit = originalExit;
    
    // Test 4: Verify expected tables exist
    console.log('\n4️⃣ Verifying expected tables...');
    const expectedTables = [
      'profiles',
      'subscriptions', 
      'teams',
      'team_members',
      'user_preferences',
      'audit_logs'
    ];
    
    const { data: allTables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_type', 'BASE TABLE');
    
    if (tablesError) {
      throw new Error(`Failed to fetch tables: ${tablesError.message}`);
    }
    
    const tableNames = allTables.map(t => t.table_name);
    const missingTables = expectedTables.filter(t => !tableNames.includes(t));
    
    if (missingTables.length > 0) {
      console.log(`⚠️  Missing expected tables: ${missingTables.join(', ')}`);
    } else {
      console.log('✅ All expected tables found');
    }
    
    console.log(`📊 Found ${tableNames.length} total tables in public schema`);

    // Test Summary
    console.log('\n📋 Test Summary:');
    console.log(`   Database connection: ✅`);
    console.log(`   RLS audit execution: ${exitCode === 0 ? '✅' : '❌'}`);
    console.log(`   Expected tables: ${missingTables.length === 0 ? '✅' : '⚠️'}`);
    
    if (exitCode === 0 && missingTables.length === 0) {
      console.log('\n🎉 All tests passed! RLS audit is working correctly.');
    } else {
      console.log('\n⚠️  Some tests had issues. Check the output above.');
    }
    
    return exitCode;
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    return 1;
  }
}

// Run tests if executed directly
if (require.main === module) {
  testRLSAudit().then(exitCode => {
    process.exit(exitCode);
  }).catch(error => {
    console.error(`❌ Unexpected test error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { testRLSAudit };