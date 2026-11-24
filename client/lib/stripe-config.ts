import Stripe from "stripe"

/**
 * Centralized Stripe Configuration
 * * Provides a single source of truth for Stripe SDK settings.
 * Using the latest stable API version supported by the Stripe SDK.
 */
export const STRIPE_API_VERSION = "2025-11-17.clover" as const;

export const stripeConfig = {
  // Cast as any to avoid string literal mismatch errors with the Stripe constructor
  apiVersion: STRIPE_API_VERSION as any,
  typescript: true as const,
}

/**
 * Determine whether the current runtime is production.
 */
export const isStripeProduction = (): boolean =>
  process.env.NODE_ENV === "production"

/**
 * Resolve the Stripe secret key, preferring environment-specific keys.
 *
 * Resolution order:
 *  1. Explicit `apiKey` argument (for tests / manual override)
 *  2. STRIPE_LIVE_SECRET_KEY  (production) or STRIPE_TEST_SECRET_KEY  (non-production)
 *  3. Generic STRIPE_SECRET_KEY fallback
 */
export const resolveStripeKey = (apiKey?: string): string | null => {
  if (apiKey) return apiKey

  const isLive = isStripeProduction()
  const envKey = isLive
    ? process.env.STRIPE_LIVE_SECRET_KEY
    : process.env.STRIPE_TEST_SECRET_KEY

  return envKey || process.env.STRIPE_SECRET_KEY || null
}

/**
 * Initialize a Stripe instance with standard configuration.
 *
 * Logs a warning when a test-mode key (`sk_test_`) is detected in a
 * production environment to prevent accidental usage.
 */
export const getStripeInstance = (apiKey?: string) => {
  const key = resolveStripeKey(apiKey)
  if (!key) return null

  // Safety: warn if a test key leaks into production
  if (isStripeProduction() && key.startsWith("sk_test_")) {
    console.warn(
      "[Stripe] ⚠️  A test-mode secret key is being used in a production environment. " +
        "Set STRIPE_LIVE_SECRET_KEY to your live key to resolve this."
    )
  }

  return new Stripe(key, stripeConfig)
}