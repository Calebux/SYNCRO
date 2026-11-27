/**
 * Route-level rate limit configuration (import, payment, tag mutations).
 * Limits are loaded from environment variables with safe defaults.
 */

export type RouteRateLimitPolicy = 'import' | 'payment' | 'tagMutation'

export type RouteRateLimitPolicyConfig = {
  enabled: boolean
  windowMs: number
  maxRequests: number
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseEnabled(value: string | undefined, fallback = true): boolean {
  if (value === undefined) return fallback
  const normalized = value.toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return fallback
}

const DEFAULTS: Record<RouteRateLimitPolicy, { maxRequests: number; windowMinutes: number }> = {
  import: { maxRequests: 5, windowMinutes: 60 },
  payment: { maxRequests: 10, windowMinutes: 60 },
  tagMutation: { maxRequests: 30, windowMinutes: 15 },
}

function loadPolicy(
  policy: RouteRateLimitPolicy,
  envPrefix: string,
): RouteRateLimitPolicyConfig {
  const defaults = DEFAULTS[policy]
  const maxRequests = parsePositiveInt(
    process.env[`${envPrefix}_MAX`],
    defaults.maxRequests,
  )
  const windowMinutes = parsePositiveInt(
    process.env[`${envPrefix}_WINDOW_MINUTES`],
    defaults.windowMinutes,
  )

  return {
    enabled: parseEnabled(process.env.RATE_LIMIT_ENABLED, true),
    windowMs: windowMinutes * 60 * 1000,
    maxRequests,
  }
}

let cachedConfig: Record<RouteRateLimitPolicy, RouteRateLimitPolicyConfig> | null = null

export function getRouteRateLimitConfig(
  policy: RouteRateLimitPolicy,
): RouteRateLimitPolicyConfig {
  if (!cachedConfig) {
    cachedConfig = {
      import: loadPolicy('import', 'RATE_LIMIT_IMPORT'),
      payment: loadPolicy('payment', 'RATE_LIMIT_PAYMENT'),
      tagMutation: loadPolicy('tagMutation', 'RATE_LIMIT_TAG_MUTATION'),
    }
  }
  return cachedConfig[policy]
}

/** Reset cached config (for tests). */
export function resetRouteRateLimitConfig(): void {
  cachedConfig = null
}
