/**
 * Standalone env validation script.
 * Run with: npx ts-node scripts/validate-env.ts
 * Or via: npm run validate:env
 */

import dotenv from 'dotenv';
dotenv.config();

import { validateEnv } from '../src/config/env';

try {
  validateEnv();
  console.log('✓ All required environment variables are present and valid.');
  process.exit(0);
} catch (err) {
  console.error('✗ Environment validation failed:\n');
  console.error((err as Error).message);
  process.exit(1);
}
