import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request } from 'express';
import { rateLimitConfig } from '../config/rate-limit';
import { createRedisStore } from '../lib/redis-store';
import { AuthenticatedRequest } from './auth';
import logger from '../config/logger';

/**
 * Key generator for user-based rate limiting
 */
function userKeyGenerator(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  // Use user ID if available (authenticated), otherwise fall back to IP
  return userId || ip;
}

/**
 * Key generator for IP-based rate limiting
 */
function ipKeyGenerator(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Enhanced rate limit handler that logs security events
 */
function createRateLimitHandler(endpointType: string) {
  return (req: Request, res: any) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    logger.warn('Rate limit exceeded', {
      type: 'rate_limit_exceeded',
      endpoint: endpointType,
      userId: userId || null,
      ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method,
    });

    // Add additional security headers
    res.set({
      'X-RateLimit-Policy': endpointType,
      'X-Security-Event': 'rate-limit-exceeded',
    });
  };
}

export class RateLimiterFactory {
  private static redisStore: any = null;
  private static redisStoreInitialized = false;

  /**
   * Initialize Redis store (called once at startup)
   */
  static async initializeRedisStore(): Promise<void> {
    if (this.redisStoreInitialized) return;
    
    try {
      this.redisStore = await createRedisStore();
      this.redisStoreInitialized = true;
      
      if (this.redisStore) {
        logger.info('Rate limiting using Redis store');
      } else {
        logger.info('Rate limiting using memory store (Redis unavailable)');
      }
    } catch (error) {
      logger.warn('Failed to initialize Redis store for rate limiting, using memory store:', error);
      this.redisStore = null;
      this.redisStoreInitialized = true;
    }
  }

  /**
   * Create rate limiter for team invitation endpoints
   * 20 requests per hour per user
   */
  static createTeamInviteLimiter(): RateLimitRequestHandler {
    return rateLimit({
      windowMs: rateLimitConfig.teamInvite.windowMs,
      max: rateLimitConfig.teamInvite.max,
      message: rateLimitConfig.teamInvite.message,
      standardHeaders: true,
      legacyHeaders: true,
      keyGenerator: userKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler('team-invite')(req, res);
        res.status(429).json(rateLimitConfig.teamInvite.message);
      },
      // Skip rate limiting for non-authenticated requests (they'll fail auth anyway)
      skip: (req) => {
        const authReq = req as AuthenticatedRequest;
        return !authReq.user?.id;
      },
    });
  }

  /**
   * Create rate limiter for MFA endpoints
   * 10 requests per 15 minutes per user
   */
  static createMfaLimiter(): RateLimitRequestHandler {
    return rateLimit({
      windowMs: rateLimitConfig.mfa.windowMs,
      max: rateLimitConfig.mfa.max,
      message: rateLimitConfig.mfa.message,
      standardHeaders: true,
      legacyHeaders: true,
      keyGenerator: userKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler('mfa')(req, res);
        res.status(429).json(rateLimitConfig.mfa.message);
      },
      // Skip rate limiting for non-authenticated requests
      skip: (req) => {
        const authReq = req as AuthenticatedRequest;
        return !authReq.user?.id;
      },
    });
  }

  /**
   * Create rate limiter for admin endpoints
   * 100 requests per hour per IP
   */
  static createAdminLimiter(): RateLimitRequestHandler {
    return rateLimit({
      windowMs: rateLimitConfig.admin.windowMs,
      max: rateLimitConfig.admin.max,
      message: rateLimitConfig.admin.message,
      standardHeaders: true,
      legacyHeaders: true,
      keyGenerator: ipKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler('admin')(req, res);
        res.status(429).json(rateLimitConfig.admin.message);
      },
    });
  }

  /**
   * Create a generic rate limiter with custom configuration
   */
  static createCustomLimiter(config: {
    windowMs: number;
    max: number;
    message: { error: string };
    keyGenerator?: (req: Request) => string;
    endpointType: string;
  }): RateLimitRequestHandler {
    return rateLimit({
      windowMs: config.windowMs,
      max: config.max,
      message: config.message,
      standardHeaders: true,
      legacyHeaders: true,
      keyGenerator: config.keyGenerator || ipKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler(config.endpointType)(req, res);
        res.status(429).json(config.message);
      },
    });
  }

  /**
   * Get Redis store status for health monitoring
   */
  static getStoreStatus(): { type: 'redis' | 'memory'; available: boolean } {
    return {
      type: this.redisStore ? 'redis' : 'memory',
      available: this.redisStoreInitialized,
    };
  }
}

// Export individual limiter creators for convenience
export const createTeamInviteLimiter = () => RateLimiterFactory.createTeamInviteLimiter();
export const createMfaLimiter = () => RateLimiterFactory.createMfaLimiter();
export const createAdminLimiter = () => RateLimiterFactory.createAdminLimiter();