// Test setup - provide non-production defaults for modules that validate env on import.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-jest-only';
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test-admin-key-for-jest';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.SMTP_PORT = process.env.SMTP_PORT || '1025';
process.env.SMTP_USER = process.env.SMTP_USER || 'test';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'test';
process.env.STELLAR_NETWORK_URL = process.env.STELLAR_NETWORK_URL || 'https://soroban-testnet.stellar.org';
process.env.SOROBAN_CONTRACT_ADDRESS = process.env.SOROBAN_CONTRACT_ADDRESS || 'test-contract-address';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
