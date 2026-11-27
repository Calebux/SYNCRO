import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { ApiException, createErrorResponse } from '../errors'
import {
  buildRateLimitHeaders,
  checkRateLimit,
  RateLimiters,
  resetRateLimitStore,
} from '../rate-limit'
import {
  getRouteRateLimitConfig,
  resetRouteRateLimitConfig,
} from '../rate-limit-config'

function createRequest(ip = '203.0.113.10'): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    headers: {
      'x-forwarded-for': ip,
    },
  })
}

describe('route rate limiting', () => {
  beforeEach(() => {
    resetRateLimitStore()
    resetRouteRateLimitConfig()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    resetRateLimitStore()
    resetRouteRateLimitConfig()
    vi.unstubAllEnvs()
  })

  it('loads policy defaults from environment overrides', () => {
    vi.stubEnv('RATE_LIMIT_IMPORT_MAX', '2')
    vi.stubEnv('RATE_LIMIT_IMPORT_WINDOW_MINUTES', '30')
    resetRouteRateLimitConfig()

    const config = getRouteRateLimitConfig('import')
    expect(config.maxRequests).toBe(2)
    expect(config.windowMs).toBe(30 * 60 * 1000)
  })

  it('exposes standard rate-limit headers on allowed requests', () => {
    const request = createRequest('203.0.113.20')
    const headers = RateLimiters.import(request)

    expect(headers['X-RateLimit-Limit']).toBe('5')
    expect(headers['X-RateLimit-Remaining']).toBe('4')
    expect(headers['X-RateLimit-Reset']).toBeDefined()
    expect(headers['Retry-After']).toBeUndefined()
  })

  it('throttles import requests after the configured limit', () => {
    const request = createRequest('203.0.113.21')

    for (let i = 0; i < 5; i++) {
      RateLimiters.import(request)
    }

    expect(() => RateLimiters.import(request)).toThrow(ApiException)
  })

  it('includes Retry-After and remaining=0 when throttled', () => {
    vi.stubEnv('RATE_LIMIT_PAYMENT_MAX', '1')
    vi.stubEnv('RATE_LIMIT_PAYMENT_WINDOW_MINUTES', '60')
    resetRouteRateLimitConfig()

    const request = createRequest('203.0.113.22')
    RateLimiters.payment(request)

    try {
      RateLimiters.payment(request)
      expect.fail('Expected rate limit exception')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException)
      const apiError = error as ApiException
      expect(apiError.statusCode).toBe(429)
      expect(apiError.headers?.['X-RateLimit-Remaining']).toBe('0')
      expect(apiError.headers?.['Retry-After']).toBeDefined()
      expect(Number(apiError.headers?.['Retry-After'])).toBeGreaterThan(0)
    }
  })

  it('throttles tag mutation requests independently from import', () => {
    vi.stubEnv('RATE_LIMIT_TAG_MUTATION_MAX', '2')
    vi.stubEnv('RATE_LIMIT_TAG_MUTATION_WINDOW_MINUTES', '15')
    resetRouteRateLimitConfig()

    const tagRequest = createRequest('203.0.113.23')
    const importRequest = createRequest('203.0.113.23')

    RateLimiters.tagMutation(tagRequest)
    RateLimiters.tagMutation(tagRequest)

    expect(() => RateLimiters.tagMutation(tagRequest)).toThrow(ApiException)
    expect(() => RateLimiters.import(importRequest)).not.toThrow()
  })

  it('skips enforcement when RATE_LIMIT_ENABLED is false', () => {
    vi.stubEnv('RATE_LIMIT_ENABLED', 'false')
    resetRouteRateLimitConfig()

    const request = createRequest('203.0.113.24')
    const config = getRouteRateLimitConfig('import')

    for (let i = 0; i < 20; i++) {
      const result = checkRateLimit(request, {
        windowMs: config.windowMs,
        maxRequests: config.maxRequests,
        enabled: config.enabled,
      })
      expect(result.allowed).toBe(true)
    }
  })

  it('returns 429 JSON with rate-limit headers via createErrorResponse', async () => {
    vi.stubEnv('RATE_LIMIT_PAYMENT_MAX', '1')
    resetRouteRateLimitConfig()

    const request = createRequest('203.0.113.25')
    RateLimiters.payment(request)

    try {
      RateLimiters.payment(request)
      expect.fail('Expected rate limit exception')
    } catch (error) {
      const response = createErrorResponse(error, 'test-request-id')
      expect(response.status).toBe(429)
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
      expect(response.headers.get('Retry-After')).toBeTruthy()
      const body = await response.json()
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED')
    }
  })

  it('buildRateLimitHeaders reflects limit and reset metadata', () => {
    const resetAt = Date.now() + 60_000
    const headers = buildRateLimitHeaders({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetAt,
    })

    expect(headers['X-RateLimit-Limit']).toBe('3')
    expect(headers['X-RateLimit-Remaining']).toBe('0')
    expect(headers['X-RateLimit-Reset']).toBe(String(Math.ceil(resetAt / 1000)))
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0)
  })
})
