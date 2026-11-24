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

  // Security guard: testnet actions must never be enabled on mainnet.
  const network = (process.env.NETWORK || process.env.STELLAR_NETWORK || '').toLowerCase();
  const isMainnet = network === 'mainnet' || network === 'public';
  if (isMainnet && process.env.ENABLE_TESTNET_ACTIONS === 'true') {
    throw new Error(
      'ENABLE_TESTNET_ACTIONS=true is forbidden on mainnet. ' +
        'This flag seeds agent grants and must only be enabled on testnet.',
    );
  }

  console.log('✓ All required environment variables are present and valid.');
  process.exit(0);
} catch (err) {
  console.error('✗ Environment validation failed:\n');
  console.error((err as Error).message);
  process.exit(1);
}
