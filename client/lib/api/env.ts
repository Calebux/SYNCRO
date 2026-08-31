/**
 * Environment Configuration & Validation
 * Centralized environment variable management with validation
 */

import { z } from 'zod'

/**
 * Environment schema
 * Uses partial() to allow missing optional vars, but validates required ones
 */
const envSchema = z.object({
  // Supabase — anon key only; service-role key intentionally excluded from client
  // to prevent accidental privilege escalation. Backend uses SERVICE_ROLE_KEY directly.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('Invalid Supabase URL').optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'Supabase anon key required').optional(),

  // API Configuration
  // NEXT_PUBLIC_API_URL is the canonical name; NEXT_PUBLIC_API_BASE is the
  // deprecated alias kept for backward compatibility (see docs/ENVIRONMENT.md).
  NEXT_PUBLIC_API_URL: z.string().url('Invalid API URL').optional(),
  NEXT_PUBLIC_API_BASE: z.string().url('Invalid API base URL').optional(),
  API_SECRET_KEY: z.string().min(1, 'API secret key required').optional(),

  // Rate Limiting
  RATE_LIMIT_ENABLED: z.string().transform((val) => val === 'true').default('true'),
  RATE_LIMIT_REDIS_URL: z.string().url('Invalid Redis URL').optional(),
  RATE_LIMIT_IMPORT_MAX: z.string().optional(),
  RATE_LIMIT_IMPORT_WINDOW_MINUTES: z.string().optional(),
  RATE_LIMIT_PAYMENT_MAX: z.string().optional(),
  RATE_LIMIT_PAYMENT_WINDOW_MINUTES: z.string().optional(),
  RATE_LIMIT_TAG_MUTATION_MAX: z.string().optional(),
  RATE_LIMIT_TAG_MUTATION_WINDOW_MINUTES: z.string().optional(),

  // External Services — Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // External Services — Paystack
  PAYSTACK_SECRET_KEY: z.string().optional(),

  // External Services — PayPal
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

  // System
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MAINTENANCE_MODE: z.string().transform((val) => val === 'true').default('false'),

  // Security
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters').optional(),
  ENCRYPTION_KEY: z.string().min(32, 'Encryption key must be at least 32 characters').optional(),

  // Monitoring
  SENTRY_DSN: z.string().url('Invalid Sentry DSN').optional(),
  ANALYTICS_ID: z.string().optional(),
}).partial()

/**
 * Validated environment variables
 */
type Env = z.infer<typeof envSchema>

let validatedEnv: Env | null = null

/**
 * Get validated environment variables
 * In development, missing vars won't cause errors (returns partial)
 */
export function getEnv(): Env {
  if (validatedEnv) {
    return validatedEnv
  }

  try {
    validatedEnv = envSchema.parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
      NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE,
      API_SECRET_KEY: process.env.API_SECRET_KEY,
      RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
      RATE_LIMIT_REDIS_URL: process.env.RATE_LIMIT_REDIS_URL,
      RATE_LIMIT_IMPORT_MAX: process.env.RATE_LIMIT_IMPORT_MAX,
      RATE_LIMIT_IMPORT_WINDOW_MINUTES: process.env.RATE_LIMIT_IMPORT_WINDOW_MINUTES,
      RATE_LIMIT_PAYMENT_MAX: process.env.RATE_LIMIT_PAYMENT_MAX,
      RATE_LIMIT_PAYMENT_WINDOW_MINUTES: process.env.RATE_LIMIT_PAYMENT_WINDOW_MINUTES,
      RATE_LIMIT_TAG_MUTATION_MAX: process.env.RATE_LIMIT_TAG_MUTATION_MAX,
      RATE_LIMIT_TAG_MUTATION_WINDOW_MINUTES:
        process.env.RATE_LIMIT_TAG_MUTATION_WINDOW_MINUTES,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
      PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
      PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
      PAYPAL_MODE: process.env.PAYPAL_MODE,
      NODE_ENV: process.env.NODE_ENV,
      LOG_LEVEL: process.env.LOG_LEVEL,
      MAINTENANCE_MODE: process.env.MAINTENANCE_MODE,
      JWT_SECRET: process.env.JWT_SECRET,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
      SENTRY_DSN: process.env.SENTRY_DSN,
      ANALYTICS_ID: process.env.ANALYTICS_ID,
    }) as Env

    return validatedEnv
  } catch (error) {
    // In development, return partial env instead of throwing
    if (process.env.NODE_ENV === 'development') {
      console.warn('Some environment variables are missing or invalid:', error)
      return {} as Env
    }

    if (error instanceof z.ZodError) {
      const missing = error.errors.map((e) => e.path.join('.')).join(', ')
      throw new Error(`Missing or invalid environment variables: ${missing}`)
    }
    throw error
  }
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production'
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return getEnv().NODE_ENV === 'development'
}

/**
 * Check if maintenance mode is enabled
 */
export function isMaintenanceMode(): boolean {
  return getEnv().MAINTENANCE_MODE === true
}

/**
 * Get API configuration
 */
export function getApiConfig() {
  const env = getEnv()
  const stagingApi  = 'https://backend-staging.onrender.com'
  const productionApi = 'https://backend-ai-sub.onrender.com'
  const defaultBase =
    process.env.NEXT_PUBLIC_APP_ENV === 'staging' ? stagingApi : productionApi
  return {
    // Prefer the canonical NEXT_PUBLIC_API_URL; fall back to the deprecated
    // NEXT_PUBLIC_API_BASE so existing deployments keep working.
    baseUrl: env.NEXT_PUBLIC_API_URL || env.NEXT_PUBLIC_API_BASE || defaultBase,
    secretKey: env.API_SECRET_KEY,
    rateLimitEnabled: env.RATE_LIMIT_ENABLED,
  }
}