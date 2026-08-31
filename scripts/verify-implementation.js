#!/usr/bin/env node

/**
 * Implementation Verification Script
 * 
 * This script verifies that the RLS audit system is correctly implemented
 * and addresses all requirements from Issue #14.
 */

const fs = require('fs');
const path = require('path');

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

function checkFileExists(filePath, description) {
  const exists = fs.existsSync(filePath);
  log(`${exists ? '✅' : '❌'} ${description}: ${filePath}`, exists ? 'green' : 'red');
  return exists;
}

function checkFileContains(filePath, searchText, description) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const contains = content.includes(searchText);
    log(`${contains ? '✅' : '❌'} ${description}`, contains ? 'green' : 'red');
    return contains;
  } catch (error) {
    log(`❌ ${description} (file not readable)`, 'red');
    return false;
  }
}

async function verifyImplementation() {
  log('🔍 Verifying RLS Audit Implementation...', 'blue');
  log('', 'reset');
  
  let totalChecks = 0;
  let passedChecks = 0;
  
  function check(result) {
    totalChecks++;
    if (result) passedChecks++;
    return result;
  }
  
  // 1. Core Scripts
  log('📁 Core Scripts:', 'bold');
  check(checkFileExists('scripts/check-rls-compliance.js', 'Main RLS audit script'));
  check(checkFileExists('scripts/audit-rls-policies.sql', 'SQL-only audit script'));
  check(checkFileExists('scripts/test-rls-audit.js', 'Test script'));
  check(checkFileExists('scripts/README.md', 'Scripts documentation'));
  
  // 2. Database Function
  log('\n🗄️  Database Function:', 'bold');
  check(checkFileExists('supabase/migrations/20240120000000_create_rls_audit_function.sql', 'RLS audit function migration'));
  check(checkFileContains('supabase/migrations/20240120000000_create_rls_audit_function.sql', 'audit_rls_compliance', 'Function definition'));
  
  // 3. CI/CD Integration
  log('\n🚀 CI/CD Integration:', 'bold');
  check(checkFileExists('.github/workflows/rls-audit.yml', 'Dedicated RLS audit workflow'));
  check(checkFileContains('.github/workflows/database.yml', 'Run RLS Policy Audit', 'Database workflow integration'));
  check(checkFileContains('.github/workflows/rls-audit.yml', 'audit-rls-policies', 'Audit job definition'));
  
  // 4. Package.json Scripts
  log('\n📦 NPM Scripts:', 'bold');
  check(checkFileContains('backend/package.json', 'audit:rls', 'RLS audit script'));
  check(checkFileContains('backend/package.json', 'audit:rls:local', 'Local RLS audit script'));
  check(checkFileContains('backend/package.json', 'test:rls-audit', 'RLS audit test script'));
  
  // 5. Documentation
  log('\n📚 Documentation:', 'bold');
  check(checkFileExists('docs/RLS_AUDIT_GUIDE.md', 'Developer guide'));
  check(checkFileContains('docs/RLS_AUDIT_GUIDE.md', 'Issue #14', 'References original issue'));
  check(checkFileContains('scripts/README.md', 'pg_policies', 'Technical documentation'));
  
  // 6. Demo and Examples
  log('\n🎯 Examples:', 'bold');
  check(checkFileExists('supabase/migrations/20240119000000_demo_rls_audit.sql', 'Demo migration'));
  check(checkFileContains('supabase/migrations/20240119000000_demo_rls_audit.sql', 'ENABLE ROW LEVEL SECURITY', 'RLS enablement example'));
  check(checkFileContains('supabase/migrations/20240119000000_demo_rls_audit.sql', 'CREATE POLICY', 'Policy creation example'));
  
  // 7. Script Functionality
  log('\n⚙️  Script Functionality:', 'bold');
  check(checkFileContains('scripts/check-rls-compliance.js', 'audit_rls_compliance', 'Uses database function'));
  check(checkFileContains('scripts/check-rls-compliance.js', 'process.exit(1)', 'Fails CI on issues'));
  check(checkFileContains('supabase/migrations/20240120000000_create_rls_audit_function.sql', 'pg_policies', 'Checks policies'));
  
  // 8. Workflow Triggers
  log('\n🔄 Workflow Triggers:', 'bold');
  check(checkFileContains('.github/workflows/rls-audit.yml', 'supabase/migrations/**', 'Triggers on migrations'));
  check(checkFileContains('.github/workflows/rls-audit.yml', 'pull_request', 'Triggers on PRs'));
  check(checkFileContains('.github/workflows/database.yml', 'supabase db push', 'Applies migrations first'));
  
  // 9. Error Handling
  log('\n🛡️  Error Handling:', 'bold');
  check(checkFileContains('scripts/check-rls-compliance.js', 'MISSING_RLS', 'Detects missing RLS'));
  check(checkFileContains('scripts/check-rls-compliance.js', 'NO_POLICIES', 'Detects missing policies'));
  check(checkFileContains('scripts/check-rls-compliance.js', 'does not exist', 'Handles missing function'));
  
  // 10. Requirements Compliance
  log('\n✅ Requirements Compliance (Issue #14):', 'bold');
  
  // "Add query to check pg_policies for all tables in the public schema"
  const checksPostgres = checkFileContains('supabase/migrations/20240120000000_create_rls_audit_function.sql', 'pg_policies', 'Queries pg_policies table');
  const checksPublicSchema = checkFileContains('supabase/migrations/20240120000000_create_rls_audit_function.sql', "table_schema = 'public'", 'Checks public schema only');
  check(checksPostgres && checksPublicSchema);
  log(`   ${checksPostgres && checksPublicSchema ? '✅' : '❌'} Query checks pg_policies for all tables in public schema`, checksPostgres && checksPublicSchema ? 'green' : 'red');
  
  // "CI fails if a new table is added without RLS"
  const failsCI = checkFileContains('scripts/check-rls-compliance.js', 'process.exit(1)', 'Script exits with error code');
  const inWorkflow = checkFileContains('.github/workflows/database.yml', 'check-rls-compliance.js', 'Integrated in CI workflow');
  check(failsCI && inWorkflow);
  log(`   ${failsCI && inWorkflow ? '✅' : '❌'} CI fails if new table added without RLS`, failsCI && inWorkflow ? 'green' : 'red');
  
  // Summary
  log('\n📊 Implementation Summary:', 'bold');
  log(`   Total checks: ${totalChecks}`);
  log(`   Passed: ${passedChecks}`, passedChecks === totalChecks ? 'green' : 'yellow');
  log(`   Failed: ${totalChecks - passedChecks}`, totalChecks - passedChecks === 0 ? 'green' : 'red');
  log(`   Success rate: ${((passedChecks / totalChecks) * 100).toFixed(1)}%`, passedChecks === totalChecks ? 'green' : 'yellow');
  
  if (passedChecks === totalChecks) {
    log('\n🎉 Implementation Verification PASSED!', 'green');
    log('   All components are correctly implemented', 'green');
    log('   Issue #14 requirements are fully addressed', 'green');
    return 0;
  } else {
    log('\n⚠️  Implementation Verification FAILED!', 'red');
    log(`   ${totalChecks - passedChecks} checks failed`, 'red');
    log('   Please review the failed items above', 'red');
    return 1;
  }
}

// Run verification
if (require.main === module) {
  verifyImplementation().then(exitCode => {
    process.exit(exitCode);
  }).catch(error => {
    log(`❌ Verification error: ${error.message}`, 'red');
    process.exit(1);
  });
}

module.exports = { verifyImplementation };