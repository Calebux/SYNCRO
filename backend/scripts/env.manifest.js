'use strict';

/**
 * Canonical environment manifest for the backend (Node/Express API).
 *
 * SINGLE SOURCE OF TRUTH for backend environment variable *names*.
 *
 * Consumed by:
 *   - backend/scripts/validate-env.js  (runtime presence check + structural check)
 *   - scripts/check-env-docs.js        (repo-wide structural / drift check)
 *   - backend/tests/env-manifest.test.ts (parity with the zod schema in
 *                                          backend/src/config/env.ts)
 *
 * Rules:
 *   - `required`: must be present for the server to boot. Mirrors the
 *     non-optional, non-defaulted fields of the zod schema in
 *     src/config/env.ts. Keep the two in sync — the parity test enforces it.
 *   - `optional`: recognized and documented, but the server boots without them
 *     (either truly optional, or has a default in the zod schema).
 *   - Every name here MUST appear in backend/.env.example, and vice versa
 *     (enforced by the structural check).
 *
 * When adding a new backend env var, update: this manifest → src/config/env.ts
 * (if centrally validated) → backend/.env.example → docs/ENVIRONMENT.md.
 */

/** Required to boot. See docs/ENVIRONMENT.md (decision: align to zod schema). */
const required = [
  // Database (Supabase)
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',

  // Authentication
  'JWT_SECRET',

  // Admin API (security-critical)
  'ADMIN_API_KEY',

  // Email / SMTP
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',

  // Stellar / Soroban (server crashes without these)
  'STELLAR_NETWORK_URL',
  'SOROBAN_CONTRACT_ADDRESS',
];

/** Recognized but not required (optional or has a default). */
const optional = [
  // Server
  'NODE_ENV',
  'PORT',
  'FRONTEND_URL',
  'LOG_LEVEL',
  'JWT_EXPIRES_IN',

  // Database (direct Postgres connection string; Supabase is primary)
  'DATABASE_URL',

  // Secret management
  'SECRET_PROVIDER_TYPE',

  // Stellar / Soroban (optional config + feature flags)
  'SOROBAN_RPC_URL',
  'STELLAR_SECRET_KEY',
  'STELLAR_NETWORK_PASSPHRASE',
  'STELLAR_NETWORK',
  'ENABLE_BLOCKCHAIN',
  'ENABLE_TESTNET_ACTIONS',
  'INDEXER_POLL_INTERVAL_MS',
  'INDEXER_BATCH_SIZE',
  'SOROBAN_UPGRADE_ADDRESS',
  'EVENT_LISTENER_INTERVAL_MS',
  'HORIZON_URL',
  'STELLAR_HORIZON_URL',
  'STEALTH_SPEND_PUBKEY',
  'STEALTH_VIEW_PUBKEY',
  'STEALTH_META_ADDRESS',
  'STEALTH_PAYMENTS_ENABLED',
  'STEALTH_SCAN_BATCH_SIZE',
  'PAYMENT_CHANNELS_ENABLED',
  'FX_ORACLE_ENABLED',
  'SETTLEMENT_MIN_BATCH',
  'SETTLEMENT_MAX_BATCH',
  'SETTLEMENT_MAX_WAIT_MS',
  'SETTLEMENT_MAX_QUEUE_DEPTH',
  'SETTLEMENT_MAX_IN_FLIGHT',
  'MERCHANT_CACHE_TTL_MS',
  'UNSUBSCRIBE_SECRET',
  'BACKEND_URL',
  'COMMITMENT_ENCRYPTION_KEY',
  'QUERY_CACHE_ENABLED',
  'QUERY_CACHE_SUBSCRIPTION_LIST_TTL_MS',
  'QUERY_CACHE_ANALYTICS_TTL_MS',
  'HEALTH_THRESHOLD_FAILED_RENEWALS_PER_HOUR',
  'HEALTH_THRESHOLD_CONTRACT_ERRORS_PER_HOUR',
  'HEALTH_THRESHOLD_AGENT_INACTIVITY_HOURS',
  'LLM_PARSE_CONCURRENCY',
  'JOB_ALERT_MONITOR_ENABLED',
  'STEALTH_SCANNER_ENABLED',
  'CSP_INTERNAL_TOKEN',
  'RENEWAL_LOCK_TTL_MS',

  // Payment providers & channel secrets
  'CHANNEL_SIGNING_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_MODE',

  // Paystack — African market users (NG, GH, ZA, KE)
  'PAYSTACK_SECRET_KEY',

  // Google / Gmail integration
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',

  // Microsoft 365 / Outlook integration
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_TENANT_ID',
  'MICROSOFT_REDIRECT_URI',

  // Encryption
  'ENCRYPTION_KEY',

  // Calendar sync (iCal feed)
  'CALENDAR_SECRET',
  'CALENDAR_FEED_BASE_URL',

  // Telegram bot
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',

  // Slack notifications
  'SLACK_WEBHOOK_URL',

  // Redis / rate limiting
  'REDIS_URL',
  'RATE_LIMIT_REDIS_URL',
  'RATE_LIMIT_REDIS_ENABLED',
  'RATE_LIMIT_TEAM_INVITE_MAX',
  'RATE_LIMIT_TEAM_INVITE_WINDOW_HOURS',
  'RATE_LIMIT_MFA_MAX',
  'RATE_LIMIT_MFA_WINDOW_MINUTES',
  'RATE_LIMIT_LOGIN_MAX',
  'RATE_LIMIT_LOGIN_WINDOW_MINUTES',
  'RATE_LIMIT_IMPORT_MAX',
  'RATE_LIMIT_IMPORT_WINDOW_HOURS',
  'RATE_LIMIT_PAYMENT_MAX',
  'RATE_LIMIT_PAYMENT_WINDOW_HOURS',
  'RATE_LIMIT_REFUND_MAX',
  'RATE_LIMIT_REFUND_WINDOW_HOURS',
  'RATE_LIMIT_API_KEY_MAX',
  'RATE_LIMIT_API_KEY_WINDOW_HOURS',
  'RATE_LIMIT_ADMIN_MAX',
  'RATE_LIMIT_ADMIN_WINDOW_HOURS',
  'RATE_LIMIT_SIMULATION_MAX',
  'RATE_LIMIT_SIMULATION_WINDOW_HOURS',
  'RATE_LIMIT_STEALTH_ADDRESS_MAX',
  'RATE_LIMIT_STEALTH_ADDRESS_WINDOW_HOURS',
  'RATE_LIMIT_ZK_PROOF_MAX',
  'RATE_LIMIT_ZK_PROOF_WINDOW_MINUTES',
  'RATE_LIMIT_PAYMENT_CHANNEL_MAX_OPEN',
  'RATE_LIMIT_PAYMENT_CHANNEL_MAX_STATE_UPDATES',
  'RATE_LIMIT_PAYMENT_CHANNEL_STATE_UPDATE_RATE_MAX',
  'RATE_LIMIT_PAYMENT_CHANNEL_STATE_UPDATE_WINDOW_HOURS',
  'RATE_LIMIT_SETTLEMENT_MAX_BATCH_SIZE',
  'RATE_LIMIT_SELECTIVE_DISCLOSURE_MAX',
  'RATE_LIMIT_SELECTIVE_DISCLOSURE_WINDOW_HOURS',

  // Push notifications
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',

  // External AI APIs & LLM Budget/Cache
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'LLM_BUDGET_USER_DAILY_USD',
  'LLM_BUDGET_GLOBAL_DAILY_USD',
  'LLM_BUDGET_ALERT_THRESHOLD',
  'LLM_TEMPLATE_CACHE_MAX',
  'LLM_TEMPLATE_CACHE_TTL_MS',

  // Exchange rate cache (#1092)
  'EXCHANGE_RATE_TTL_MS',
  'EXCHANGE_RATE_CACHE_JITTER_FACTOR',
  'EXCHANGE_RATE_CACHE_SWR_FACTOR',

  // Merchant metadata cache (#1092)
  'MERCHANT_CACHE_TTL_MS',

  // Monitoring (Sentry & Alerts)
  'SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_RELEASE',
  'SENTRY_ENVIRONMENT',
  'COMMIT_SHA',
  'WEBHOOK_SIGNATURE_ALERT_THRESHOLD',
  'WEBHOOK_SIGNATURE_ALERT_COOLDOWN_MS',
  'JOB_ALERT_COOLDOWN_MS',
  'WEBHOOK_MAX_ATTEMPTS',

  // CSP monitoring
  'CSP_MONITORING_ENABLED',
  'CSP_ALERT_HOURLY_RATE',
  'CSP_ALERT_AFFECTED_USERS',

  // Risk calculation & External Defaults
  'RISK_CALC_CONCURRENCY',
  'EXTERNAL_SERVICE_DEFAULT_TIMEOUT',
  'EXTERNAL_SERVICE_DEFAULT_RETRIES',
  'EXPIRY_DAYS_MONTHLY',
  'EXPIRY_DAYS_QUARTERLY',
  'EXPIRY_DAYS_YEARLY',
  'EXPIRY_WARNING_DAYS',
  'RISK_WEIGHT_CONSECUTIVE_NONE',
  'RISK_WEIGHT_CONSECUTIVE_MEDIUM',
  'RISK_WEIGHT_CONSECUTIVE_HIGH',
  'RISK_WEIGHT_BALANCE_SUFFICIENT',
  'RISK_WEIGHT_BALANCE_LOW',
  'RISK_WEIGHT_BALANCE_INSUFFICIENT',
  'RISK_WEIGHT_APPROVAL_VALID',
  'RISK_WEIGHT_APPROVAL_EXPIRED',

  // Agent HD Wallet — Address Rotation (Issue #862)
  'AGENT_MASTER_SEED',
  'AGENT_ROTATION_SCHEDULE',
];

/** Deprecated names that must NOT appear as active keys in .env.example. */
const deprecated = {};

module.exports = { package: 'backend', required, optional, deprecated };
