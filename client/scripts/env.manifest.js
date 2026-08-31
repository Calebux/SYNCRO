'use strict';

/**
 * Canonical environment manifest for the client (Next.js frontend).
 *
 * SINGLE SOURCE OF TRUTH for client environment variable *names*.
 *
 * Consumed by:
 *   - client/scripts/validate-env.js  (build-time presence check + structural check)
 *   - scripts/check-env-docs.js        (repo-wide structural / drift check)
 *
 * Conventions:
 *   - `NEXT_PUBLIC_*` vars are inlined into the browser bundle at build time.
 *     Never put a secret behind a NEXT_PUBLIC_ name.
 *   - Non-prefixed vars are server-only (used by `client/app/api/*` route
 *     handlers and middleware) and never reach the browser.
 *   - Pure test/tooling vars (CI, VITEST_STORYBOOK, E2E_BASE_URL) are
 *     intentionally excluded — they are not application configuration.
 *
 * When adding a new client env var, update: this manifest →
 * client/.env.example → docs/ENVIRONMENT.md.
 */

/** Required for a production build / runtime. */
const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  // Canonical name for the backend API base URL (was NEXT_PUBLIC_API_BASE).
  'NEXT_PUBLIC_API_URL',
  // Stripe: secret key (server-only) + publishable key (browser, Stripe.js).
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
];

/** Recognized but not required. */
const optional = [
  // Public app/runtime config (browser-exposed)
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_BACKEND_URL',
  'NEXT_PUBLIC_APP_ENV',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_SOROBAN_RPC_URL',
  'NEXT_PUBLIC_STELLAR_NETWORK',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',

  // Server-only (app/api routes, middleware)
  'SUPABASE_SERVICE_ROLE_KEY',
  'API_SECRET_KEY',
  'JWT_SECRET',
  'ENCRYPTION_KEY',

  // Payment providers (server-only)
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_TEST_SECRET_KEY',
  'STRIPE_LIVE_SECRET_KEY',
  'PAYSTACK_SECRET_KEY',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_MODE',
  'ENABLE_MOCK_PAYMENTS',

  // System
  'NODE_ENV',
  'LOG_LEVEL',
  'MAINTENANCE_MODE',
  'ANALYTICS_ID',
  'SENTRY_DSN',

  // Rate limiting
  'RATE_LIMIT_ENABLED',
  'RATE_LIMIT_REDIS_URL',
  'RATE_LIMIT_IMPORT_MAX',
  'RATE_LIMIT_IMPORT_WINDOW_MINUTES',
  'RATE_LIMIT_PAYMENT_MAX',
  'RATE_LIMIT_PAYMENT_WINDOW_MINUTES',
  'RATE_LIMIT_TAG_MUTATION_MAX',
  'RATE_LIMIT_TAG_MUTATION_WINDOW_MINUTES',
];

/** Deprecated names that must NOT appear as active keys in .env.example. */
const deprecated = {
  NEXT_PUBLIC_API_BASE: 'Use NEXT_PUBLIC_API_URL instead',
};

module.exports = { package: 'client', required, optional, deprecated };
