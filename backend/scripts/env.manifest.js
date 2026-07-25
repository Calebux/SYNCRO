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

  // Payment providers
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',

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
  'RATE_LIMIT_ADMIN_MAX',
  'RATE_LIMIT_ADMIN_WINDOW_HOURS',

  // Push notifications
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',

  // External AI APIs
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',

  // Exchange rate cache
  'EXCHANGE_RATE_TTL_MS',

  // Monitoring (Sentry)
  'SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_RELEASE',
  'SENTRY_ENVIRONMENT',
  'COMMIT_SHA',

  // CSP monitoring
  'CSP_MONITORING_ENABLED',
  'CSP_ALERT_HOURLY_RATE',
  'CSP_ALERT_AFFECTED_USERS',

  // Risk calculation
  'RISK_CALC_CONCURRENCY',

  // Agent HD Wallet — Address Rotation (Issue #862)
  'AGENT_MASTER_SEED',
  'AGENT_ROTATION_SCHEDULE',
];

/** Deprecated names that must NOT appear as active keys in .env.example. */
const deprecated = {};

module.exports = { package: 'backend', required, optional, deprecated };
