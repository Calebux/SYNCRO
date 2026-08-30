/**
 * Rate Limiting Middleware
 * Route-level in-memory rate limiting for high-risk Next.js API routes.
 */

import { type NextRequest } from 'next/server'
import { ApiErrors } from './errors'
import {
  getRouteRateLimitConfig,
  type RouteRateLimitPolicy,
  type RouteRateLimitPolicyConfig,
} from './rate-limit-config'

export type RateLimitConfig = {
  windowMs: number
  maxRequests: number
  keyGenerator?: (request: NextRequest) => string
  enabled?: boolean
}

export type RateLimitCheckResult = {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
}

export type RateLimitHeaders = Record<string, string>

type RateLimitStore = Map<string, { count: number; resetAt: number }>

const store: RateLimitStore = new Map()

// Cleanup expired entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, value] of store.entries()) {
      if (value.resetAt < now) {
        store.delete(key)
      }
    }
  }, 5 * 60 * 1000)
}

function defaultKeyGenerator(request: NextRequest): string {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  return ip
}

function policyKeyGenerator(policy: RouteRateLimitPolicy) {
  return (request: NextRequest): string => {
    const ip = defaultKeyGenerator(request)
    return `rate_limit:${policy}:${ip}`
  }
}

export function buildRateLimitHeaders(
  result: RateLimitCheckResult,
): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  }

  if (!result.allowed) {
    const retryAfter = Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 1000),
    )
    headers['Retry-After'] = String(retryAfter)
  }

  return headers
}

export function checkRateLimit(
  request: NextRequest,
  config: RateLimitConfig,
): RateLimitCheckResult {
  const limit = config.maxRequests

  if (config.enabled === false) {
    const resetAt = Date.now() + config.windowMs
    return {
      allowed: true,
      limit,
      remaining: limit,
      resetAt,
    }
  }

  const key = config.keyGenerator
    ? config.keyGenerator(request)
    : `rate_limit:${defaultKeyGenerator(request)}`

  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    const resetAt = now + config.windowMs
    store.set(key, { count: 1, resetAt })
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetAt,
    }
  }

  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: entry.resetAt,
    }
  }

  entry.count++
  store.set(key, entry)

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  }
}

export function applyRateLimitHeaders(
  response: Response,
  headers: RateLimitHeaders,
): Response {
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value)
  }
  return response
}

function enforceRateLimit(
  request: NextRequest,
  config: RateLimitConfig,
): RateLimitHeaders {
  const result = checkRateLimit(request, config)
  const headers = buildRateLimitHeaders(result)

  if (!result.allowed) {
    const resetSeconds = Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 1000),
    )
    const error = ApiErrors.rateLimitExceeded(
      `Rate limit exceeded. Try again in ${resetSeconds} seconds.`,
    )
    error.headers = headers
    throw error
  }

  return headers
}

export function createRateLimiter(config: RateLimitConfig) {
  return (request: NextRequest): RateLimitHeaders =>
    enforceRateLimit(request, config)
}

function createPolicyRateLimiter(policy: RouteRateLimitPolicy) {
  return (request: NextRequest): RateLimitHeaders => {
    const policyConfig = getRouteRateLimitConfig(policy)
    return enforceRateLimit(request, {
      windowMs: policyConfig.windowMs,
      maxRequests: policyConfig.maxRequests,
      enabled: policyConfig.enabled,
      keyGenerator: policyKeyGenerator(policy),
    })
  }
}

/**
 * High-risk route limiters (import, payment, tag mutations).
 */
export const RateLimiters = {
  import: createPolicyRateLimiter('import'),
  payment: createPolicyRateLimiter('payment'),
  tagMutation: createPolicyRateLimiter('tagMutation'),

  // General-purpose limiters used by other API routes
  strict: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
  }),
  standard: createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
  }),
  generous: createRateLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests: 1000,
  }),
  auth: createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
  }),
}

export function createUserRateLimiter(config: RateLimitConfig) {
  return (request: NextRequest, userId: string): RateLimitHeaders => {
    const userConfig: RateLimitConfig = {
      ...config,
      keyGenerator: () => `rate_limit:user:${userId}`,
    }
    return enforceRateLimit(request, userConfig)
  }
}

/** Clears the in-memory store (test helper). */
export function resetRateLimitStore(): void {
  store.clear()
}

export function getPolicyConfigForTests(
  policy: RouteRateLimitPolicy,
): RouteRateLimitPolicyConfig {
  return getRouteRateLimitConfig(policy)
}
