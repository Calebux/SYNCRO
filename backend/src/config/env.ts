import { z } from 'zod';
import logger from './logger';
import { loadManifestIntoEnv } from '../utils/manifest';

// Best-effort manifest load before any validation/parsing.
loadManifestIntoEnv(process.env.STELLAR_NETWORK ?? 'testnet');

export const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.string().default('info'),

  // Database (Supabase)
  SUPABASE_URL: z.string().url({ message: 'Missing SUPABASE_URL' }),
  SUPABASE_ANON_KEY: z.string().min(1, { message: 'Missing SUPABASE_ANON_KEY' }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, { message: 'Missing SUPABASE_SERVICE_ROLE_KEY' }),
  DATABASE_URL: z.string().optional(),

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

  // Stellar / Soroban
  STELLAR_NETWORK_URL: z.string().url({ message: 'Missing STELLAR_NETWORK_URL' }),
  SOROBAN_CONTRACT_ADDRESS: z.string().min(1, { message: 'Missing SOROBAN_CONTRACT_ADDRESS' }),
  SOROBAN_RPC_URL: z.string().url().optional(),
  STELLAR_SECRET_KEY: z.string().optional(),
  STELLAR_NETWORK_PASSPHRASE: z.string().optional(),
  STELLAR_NETWORK: z.enum(['testnet', 'mainnet', 'futurenet']).default('testnet'),
  ENABLE_BLOCKCHAIN: z.string().default('true'),
  ENABLE_TESTNET_ACTIONS: z.string().default('false'),
  INDEXER_POLL_INTERVAL_MS: z.string().default('5000'),
  INDEXER_BATCH_SIZE: z.string().default('100'),
  SOROBAN_UPGRADE_ADDRESS: z.string().optional(),
  EVENT_LISTENER_INTERVAL_MS: z.string().default('5000'),
  HORIZON_URL: z.string().optional(),
  STELLAR_HORIZON_URL: z.string().optional(),
  STEALTH_SPEND_PUBKEY: z.string().optional(),
  STEALTH_VIEW_PUBKEY: z.string().optional(),
  STEALTH_META_ADDRESS: z.string().optional(),
  STEALTH_PAYMENTS_ENABLED: z.string().optional(),
  STEALTH_SCAN_BATCH_SIZE: z.string().default('50'),
  PAYMENT_CHANNELS_ENABLED: z.string().optional(),
  FX_ORACLE_ENABLED: z.string().optional(),
  SETTLEMENT_MIN_BATCH: z.string().default('3'),
  SETTLEMENT_MAX_BATCH: z.string().default('20'),
  SETTLEMENT_MAX_WAIT_MS: z.string().default('300000'),
  SETTLEMENT_MAX_QUEUE_DEPTH: z.string().default('500'),
  SETTLEMENT_MAX_IN_FLIGHT: z.string().default('2'),
  MERCHANT_CACHE_TTL_MS: z.string().optional(),
  UNSUBSCRIBE_SECRET: z.string().optional(),
  BACKEND_URL: z.string().default('http://localhost:3001'),
  COMMITMENT_ENCRYPTION_KEY: z.string().optional(),
  QUERY_CACHE_ENABLED: z.string().default('true'),
  QUERY_CACHE_SUBSCRIPTION_LIST_TTL_MS: z.string().default('60000'),
  QUERY_CACHE_ANALYTICS_TTL_MS: z.string().default('300000'),
  HEALTH_THRESHOLD_FAILED_RENEWALS_PER_HOUR: z.string().default('10'),
  HEALTH_THRESHOLD_CONTRACT_ERRORS_PER_HOUR: z.string().default('5'),
  HEALTH_THRESHOLD_AGENT_INACTIVITY_HOURS: z.string().default('24'),
  LLM_PARSE_CONCURRENCY: z.string().default('4'),
  JOB_ALERT_MONITOR_ENABLED: z.string().default('true'),
  STEALTH_SCANNER_ENABLED: z.string().default('false'),
  CSP_INTERNAL_TOKEN: z.string().optional(),
  RENEWAL_LOCK_TTL_MS: z.string().default('300000'),

  // Payment channels & secrets
  CHANNEL_SIGNING_SECRET: z.string().default('dev-channel-secret'),
  CALENDAR_SECRET: z.string().optional(),
  CALENDAR_FEED_BASE_URL: z.string().optional(),

  // Payment providers
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_MODE: z.string().optional(),

  // Integrations
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),

  // Encryption
  ENCRYPTION_KEY: z.string().optional(),

  // Redis & Rate limiting
  REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_REDIS_ENABLED: z.string().optional(),
  RATE_LIMIT_TEAM_INVITE_MAX: z.string().optional(),
  RATE_LIMIT_TEAM_INVITE_WINDOW_HOURS: z.string().optional(),
  RATE_LIMIT_MFA_MAX: z.string().optional(),
  RATE_LIMIT_MFA_WINDOW_MINUTES: z.string().optional(),
  RATE_LIMIT_LOGIN_MAX: z.string().optional(),
  RATE_LIMIT_LOGIN_WINDOW_MINUTES: z.string().optional(),
  RATE_LIMIT_IMPORT_MAX: z.string().optional(),
  RATE_LIMIT_IMPORT_WINDOW_HOURS: z.string().optional(),
  RATE_LIMIT_PAYMENT_MAX: z.string().optional(),
  RATE_LIMIT_PAYMENT_WINDOW_HOURS: z.string().optional(),
  RATE_LIMIT_REFUND_MAX: z.string().optional(),
  RATE_LIMIT_REFUND_WINDOW_HOURS: z.string().optional(),
  RATE_LIMIT_API_KEY_MAX: z.string().optional(),
  RATE_LIMIT_API_KEY_WINDOW_HOURS: z.string().optional(),
  RATE_LIMIT_ADMIN_MAX: z.string().optional(),
  RATE_LIMIT_ADMIN_WINDOW_HOURS: z.string().optional(),
  RATE_LIMIT_SIMULATION_MAX: z.string().optional(),
  RATE_LIMIT_SIMULATION_WINDOW_HOURS: z.string().optional(),
  RATE_LIMIT_STEALTH_ADDRESS_MAX: z.string().optional(),
  RATE_LIMIT_STEALTH_ADDRESS_WINDOW_HOURS: z.string().optional(),
  RATE_LIMIT_ZK_PROOF_MAX: z.string().optional(),
  RATE_LIMIT_ZK_PROOF_WINDOW_MINUTES: z.string().optional(),
  RATE_LIMIT_PAYMENT_CHANNEL_MAX_OPEN: z.string().optional(),
  RATE_LIMIT_PAYMENT_CHANNEL_MAX_STATE_UPDATES: z.string().optional(),
  RATE_LIMIT_PAYMENT_CHANNEL_STATE_UPDATE_RATE_MAX: z.string().optional(),
  RATE_LIMIT_PAYMENT_CHANNEL_STATE_UPDATE_WINDOW_HOURS: z.string().optional(),
  RATE_LIMIT_SETTLEMENT_MAX_BATCH_SIZE: z.string().optional(),
  RATE_LIMIT_SELECTIVE_DISCLOSURE_MAX: z.string().optional(),
  RATE_LIMIT_SELECTIVE_DISCLOSURE_WINDOW_HOURS: z.string().optional(),

  // Push notifications
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // Telegram & Slack
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().optional(),

  // Monitoring & Sentry
  SENTRY_DSN: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  COMMIT_SHA: z.string().optional(),
  CSP_MONITORING_ENABLED: z.string().optional(),
  CSP_ALERT_HOURLY_RATE: z.string().default('100'),
  CSP_ALERT_AFFECTED_USERS: z.string().default('50'),
  WEBHOOK_SIGNATURE_ALERT_THRESHOLD: z.string().default('5'),
  WEBHOOK_SIGNATURE_ALERT_COOLDOWN_MS: z.string().default('900000'),
  JOB_ALERT_COOLDOWN_MS: z.string().default('900000'),
  WEBHOOK_MAX_ATTEMPTS: z.string().default('5'),

  // Secret Management & AI
  SECRET_PROVIDER_TYPE: z.enum(['local', 'aws', 'vault']).default('local'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  LLM_BUDGET_USER_DAILY_USD: z.string().default('1.0'),
  LLM_BUDGET_GLOBAL_DAILY_USD: z.string().default('50.0'),
  LLM_BUDGET_ALERT_THRESHOLD: z.string().default('0.8'),
  LLM_TEMPLATE_CACHE_MAX: z.string().default('500'),
  LLM_TEMPLATE_CACHE_TTL_MS: z.string().default('86400000'),

  // Cache & Concurrency
  EXCHANGE_RATE_TTL_MS: z.string().optional(),
  EXCHANGE_RATE_CACHE_JITTER_FACTOR: z.string().optional(),
  EXCHANGE_RATE_CACHE_SWR_FACTOR: z.string().optional(),
  MERCHANT_CACHE_TTL_MS: z.string().optional(),
  RISK_CALC_CONCURRENCY: z.string().default('10'),
  EXTERNAL_SERVICE_DEFAULT_TIMEOUT: z.string().default('10000'),
  EXTERNAL_SERVICE_DEFAULT_RETRIES: z.string().default('3'),

  // Expiry & Risk weights
  EXPIRY_DAYS_MONTHLY: z.string().optional(),
  EXPIRY_DAYS_QUARTERLY: z.string().optional(),
  EXPIRY_DAYS_YEARLY: z.string().optional(),
  EXPIRY_WARNING_DAYS: z.string().optional(),
  RISK_WEIGHT_CONSECUTIVE_NONE: z.string().optional(),
  RISK_WEIGHT_CONSECUTIVE_MEDIUM: z.string().optional(),
  RISK_WEIGHT_CONSECUTIVE_HIGH: z.string().optional(),
  RISK_WEIGHT_BALANCE_SUFFICIENT: z.string().optional(),
  RISK_WEIGHT_BALANCE_LOW: z.string().optional(),
  RISK_WEIGHT_BALANCE_INSUFFICIENT: z.string().optional(),
  RISK_WEIGHT_APPROVAL_VALID: z.string().optional(),
  RISK_WEIGHT_APPROVAL_EXPIRED: z.string().optional(),

  // Agent HD Wallet
  AGENT_MASTER_SEED: z.string().optional(),
  AGENT_ROTATION_SCHEDULE: z
    .enum(['per-task', 'daily', 'weekly', 'manual'])
    .default('daily'),
});

export type BackendEnv = z.infer<typeof envSchema>;

let cachedEnv: Readonly<BackendEnv> | null = null;

export function resetEnvCache(): void {
  cachedEnv = null;
}

export function validateEnv(): Readonly<BackendEnv> {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('\n');

    logger.error(`\n❌ Environment validation failed:\n${errors}\n`);
    process.exit(1);
  }

  const data = result.data;

  // ── Production safety checks ───────────────────────────────────────────
  if (data.NODE_ENV === 'production') {
    const prodErrors: string[] = [];

    // Reject testnet RPC URLs in production builds
    const rpcUrl = data.SOROBAN_RPC_URL ?? data.STELLAR_NETWORK_URL ?? '';
    if (rpcUrl.includes('testnet') || rpcUrl.includes('futurenet')) {
      prodErrors.push(`SOROBAN_RPC_URL / STELLAR_NETWORK_URL points to non-production endpoint ("${rpcUrl}")`);
    }

    // Reject testnet network passphrase in production
    const passphrase = data.STELLAR_NETWORK_PASSPHRASE ?? '';
    if (passphrase && passphrase.toLowerCase().includes('test')) {
      prodErrors.push('STELLAR_NETWORK_PASSPHRASE contains "test"');
    }

    // Reject STELLAR_NETWORK=testnet in production
    if (data.STELLAR_NETWORK === 'testnet' || data.STELLAR_NETWORK === 'futurenet') {
      prodErrors.push(`STELLAR_NETWORK is set to "${data.STELLAR_NETWORK}"`);
    }

    // Reject ENABLE_TESTNET_ACTIONS in production
    if (data.ENABLE_TESTNET_ACTIONS === 'true') {
      prodErrors.push('ENABLE_TESTNET_ACTIONS=true is active');
    }

    // Reject DEV_BYPASS_AUTH in production
    if (data.DEV_BYPASS_AUTH === 'true') {
      prodErrors.push('DEV_BYPASS_AUTH=true is active');
    }

    // Reject development payment channel signing secret in production
    if (data.CHANNEL_SIGNING_SECRET === 'dev-channel-secret' || data.CHANNEL_SIGNING_SECRET.includes('dev')) {
      prodErrors.push('CHANNEL_SIGNING_SECRET is using a development fallback');
    }

    // Reject development calendar secret in production
    if (!data.CALENDAR_SECRET || data.CALENDAR_SECRET.includes('dev')) {
      prodErrors.push('CALENDAR_SECRET is unconfigured or using a development fallback');
    }

    // Reject development encryption key in production
    if (!data.ENCRYPTION_KEY || data.ENCRYPTION_KEY.includes('fallback') || data.ENCRYPTION_KEY.includes('dev')) {
      prodErrors.push('ENCRYPTION_KEY is unconfigured or using a development fallback');
    }

    // Reject unverified webhooks / missing webhook secrets in production when services configured
    if (data.STRIPE_SECRET_KEY && !data.STRIPE_WEBHOOK_SECRET) {
      prodErrors.push('STRIPE_SECRET_KEY is configured but STRIPE_WEBHOOK_SECRET is missing');
    }

    if (data.TELEGRAM_BOT_TOKEN && !data.TELEGRAM_WEBHOOK_SECRET) {
      prodErrors.push('TELEGRAM_BOT_TOKEN is configured but TELEGRAM_WEBHOOK_SECRET is missing');
    }

    if (data.PAYPAL_CLIENT_ID && !data.PAYPAL_WEBHOOK_ID) {
      prodErrors.push('PAYPAL_CLIENT_ID is configured but PAYPAL_WEBHOOK_ID is missing');
    }

    if (prodErrors.length > 0) {
      const formattedErrors = prodErrors.map((err) => `  - ${err}`).join('\n');
      logger.error(`\n❌ Production safety checks failed:\n${formattedErrors}\n`);
      process.exit(1);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const frozen = Object.freeze(data);
  cachedEnv = frozen;
  return frozen;
}

export function getEnv(): Readonly<BackendEnv> {
  if (cachedEnv) {
    return cachedEnv;
  }

  return validateEnv();
}

export const env = getEnv();

