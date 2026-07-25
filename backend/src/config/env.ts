import { z } from 'zod';
import logger from './logger';
// Load durable deployment manifest (if present) so manifest-provided values
// populate `process.env` prior to validation. This favors manifests over ad-hoc
// environment strings when available but does not override explicit env vars.
import { loadManifestIntoEnv } from '../utils/manifest';

// Best-effort manifest load before any validation/parsing.
loadManifestIntoEnv(process.env.STELLAR_NETWORK ?? 'testnet');

// Exported so the env manifest parity test (tests/env-manifest.test.ts) can
// introspect which keys are required vs optional and assert they match
// backend/scripts/env.manifest.js — the single source of truth for var names.
export const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // Database (Supabase)
  SUPABASE_URL: z.string().url({ message: 'Missing SUPABASE_URL' }),
  SUPABASE_ANON_KEY: z.string().min(1, { message: 'Missing SUPABASE_ANON_KEY' }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, { message: 'Missing SUPABASE_SERVICE_ROLE_KEY' }),

  // Auth
  JWT_SECRET: z.string().min(1, { message: 'Missing JWT_SECRET' }),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Admin
  ADMIN_API_KEY: z.string().min(1, { message: 'Missing ADMIN_API_KEY' }),

  // Email / SMTP
  SMTP_HOST: z.string().min(1, { message: 'Missing SMTP_HOST' }),
  SMTP_PORT: z.string().min(1, { message: 'Missing SMTP_PORT' }),
  SMTP_USER: z.string().min(1, { message: 'Missing SMTP_USER' }),
  SMTP_PASS: z.string().min(1, { message: 'Missing SMTP_PASS' }),

  // Stellar / Soroban (required — server crashes without these)
  STELLAR_NETWORK_URL: z.string().url({ message: 'Missing STELLAR_NETWORK_URL' }),
  SOROBAN_CONTRACT_ADDRESS: z.string().min(1, { message: 'Missing SOROBAN_CONTRACT_ADDRESS' }),

  // Optional Stellar config
  SOROBAN_RPC_URL: z.string().url().optional(),
  STELLAR_SECRET_KEY: z.string().optional(),
  STELLAR_NETWORK_PASSPHRASE: z.string().optional(),

  // Blockchain feature flags (Issue #84)
  // Active Stellar network: "testnet" | "mainnet" | "futurenet"
  // Production deployments MUST set this to "mainnet".
  STELLAR_NETWORK: z.enum(['testnet', 'mainnet', 'futurenet']).default('testnet'),
  // Master switch for on-chain writes. Set to "false" to disable blockchain
  // writes and fall back to database-only logging.
  ENABLE_BLOCKCHAIN: z.string().default('true'),
  // Allow testnet-only actions (faucet, friendbot, testnet contract calls).
  // MUST NOT be set to "true" in production / mainnet environments.
  ENABLE_TESTNET_ACTIONS: z.string().default('false'),

  // Payment providers (optional)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Paystack (optional — required for African market users: NG, GH, ZA, KE)
  PAYSTACK_SECRET_KEY: z.string().optional(),

  // Google / Gmail (optional)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  // Microsoft / Outlook (optional)
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),

  // Encryption
  ENCRYPTION_KEY: z.string().optional(),

  // Redis (optional)
  REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_REDIS_ENABLED: z.string().optional(),

  // Push notifications (optional)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // Telegram (optional)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  // Sentry (optional)
  SENTRY_DSN: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  COMMIT_SHA: z.string().optional(),

  // Secret Management
  SECRET_PROVIDER_TYPE: z.enum(['local', 'aws', 'vault']).default('local'),

  // Gemini LLM (optional — enables AI fallback for email parsing)
  GEMINI_API_KEY: z.string().optional(),
  // Soroban event indexer (optional)
  INDEXER_POLL_INTERVAL_MS: z.string().optional(),
  INDEXER_BATCH_SIZE: z.string().optional(),

  // Risk calculation concurrency (number of simultaneous risk calculations per page)
  RISK_CALC_CONCURRENCY: z.string().default('10'),

  // External Service Defaults
  EXTERNAL_SERVICE_DEFAULT_TIMEOUT: z.string().default('10000'),
  EXTERNAL_SERVICE_DEFAULT_RETRIES: z.string().default('3'),

  // Agent HD wallet (Issue #862 — address rotation for pipeline agents)
  // BIP-39 mnemonic used to derive agent keypairs. Generate with:
  //   node -e "const b=require('bip39');console.log(b.generateMnemonic(256))"
  // REQUIRED when ENABLE_BLOCKCHAIN=true; optional in test/blockchain-disabled mode.
  AGENT_MASTER_SEED: z.string().optional(),
  // How often agent wallets rotate: "per-task" | "daily" | "weekly" | "manual"
  AGENT_ROTATION_SCHEDULE: z
    .enum(['per-task', 'daily', 'weekly', 'manual'])
    .default('daily'),
});

export type BackendEnv = z.infer<typeof envSchema>;

let cachedEnv: BackendEnv | null = null;

export function validateEnv(): BackendEnv {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.message || issue.path.join('.')}`)
      .join('\n');

    logger.error(`\n❌ Environment validation failed:\n${errors}\n`);
    process.exit(1);
  }

  const data = result.data;

  // ── Production safety checks for blockchain flags (Issue #84) ─────────────
  if (data.NODE_ENV === 'production') {
    // Reject testnet RPC URLs in production builds
    const rpcUrl = data.SOROBAN_RPC_URL ?? data.STELLAR_NETWORK_URL ?? '';
    if (rpcUrl.includes('testnet') || rpcUrl.includes('futurenet')) {
      logger.error(
        '\n❌ Production safety check failed: SOROBAN_RPC_URL / STELLAR_NETWORK_URL ' +
          `points to a non-production endpoint ("${rpcUrl}"). ` +
          'Set the URL to a mainnet RPC endpoint.\n',
      );
      process.exit(1);
    }

    // Reject testnet network passphrase in production
    const passphrase = data.STELLAR_NETWORK_PASSPHRASE ?? '';
    if (passphrase && passphrase.toLowerCase().includes('test')) {
      logger.error(
        '\n❌ Production safety check failed: STELLAR_NETWORK_PASSPHRASE ' +
          'contains "test" — this looks like a testnet passphrase. ' +
          'Set it to the mainnet passphrase.\n',
      );
      process.exit(1);
    }

    // Reject STELLAR_NETWORK=testnet in production
    if (data.STELLAR_NETWORK === 'testnet' || data.STELLAR_NETWORK === 'futurenet') {
      logger.error(
        `\n❌ Production safety check failed: STELLAR_NETWORK is set to ` +
          `"${data.STELLAR_NETWORK}" in a production environment. ` +
          'Set STELLAR_NETWORK=mainnet for production deployments.\n',
      );
      process.exit(1);
    }

    // Warn loudly if ENABLE_TESTNET_ACTIONS is true in production
    if (data.ENABLE_TESTNET_ACTIONS === 'true') {
      logger.error(
        '\n❌ Production safety check failed: ENABLE_TESTNET_ACTIONS=true is not ' +
          'permitted in production. Remove this flag or set it to false.\n',
      );
      process.exit(1);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  cachedEnv = data;
  return data;
}

export function getEnv(): BackendEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  return validateEnv();
}

// Skip validation in test environment to avoid requiring all vars in unit tests
export const env = process.env.NODE_ENV === 'test'
  ? (process.env as unknown as BackendEnv)
  : getEnv();
