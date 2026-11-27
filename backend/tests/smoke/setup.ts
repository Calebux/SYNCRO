/**
 * Smoke test setup
 * Configures environment and utilities for post-deployment smoke tests
 */

// Extend Jest timeout for smoke tests (network operations)
jest.setTimeout(30000);

// Suppress console logs during tests unless VERBOSE is set
if (!process.env.VERBOSE) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
}

// Validate required environment variables
const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables for smoke tests:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\nPlease set these variables before running smoke tests.');
  process.exit(1);
}

// Log smoke test configuration
console.log('🔥 Smoke Test Configuration:');
console.log(`   Base URL: ${process.env.SMOKE_TEST_BASE_URL || 'http://localhost:3001'}`);
console.log(`   Frontend URL: ${process.env.SMOKE_TEST_FRONTEND_URL || 'http://localhost:3000'}`);
console.log(`   Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`   Test User: ${process.env.SMOKE_TEST_USER_EMAIL || 'smoke-test@syncro.test'}`);
console.log('');
