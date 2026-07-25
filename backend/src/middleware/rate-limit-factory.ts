import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, RequestHandler } from 'express';
import { rateLimitConfig } from '../config/rate-limit';
import { createRedisStore } from '../lib/redis-store';
import { AuthenticatedRequest } from './auth';
import logger from '../config/logger';
import { createSubscriptionTierLimiter, TierRateLimiterOptions } from './subscription-tier-rate-limiter';

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
      validate: false,
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
      validate: false,
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
      validate: false,
      keyGenerator: ipKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler('admin')(req, res);
        res.status(429).json(rateLimitConfig.admin.message);
      },
    });
  }

  /**
   * Create rate limiter for simulation endpoints
   * 5 requests per hour per user
   */
  static createSimulationLimiter(): RateLimitRequestHandler {
    return rateLimit({
      windowMs: rateLimitConfig.simulation.windowMs,
      max: rateLimitConfig.simulation.max,
      message: rateLimitConfig.simulation.message,
      standardHeaders: true,
      legacyHeaders: true,
      validate: false,
      keyGenerator: userKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler('simulation')(req, res);
        res.status(429).json(rateLimitConfig.simulation.message);
      },
      skip: (req) => {
        const authReq = req as AuthenticatedRequest;
        return !authReq.user?.id;
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
      validate: false,
      keyGenerator: config.keyGenerator || ipKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler(config.endpointType)(req, res);
        res.status(429).json(config.message);
      },
    });
  }

  /**
   * Create rate limiter for stealth address operations
   * 100 derivations per hour per user
   */
  static createStealthAddressLimiter(): RateLimitRequestHandler {
    return rateLimit({
      windowMs: rateLimitConfig.privacy.stealthAddress.windowMs,
      max: rateLimitConfig.privacy.stealthAddress.max,
      message: rateLimitConfig.privacy.stealthAddress.message,
      standardHeaders: true,
      legacyHeaders: true,
      validate: false,
      keyGenerator: userKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler('stealth-address')(req, res);
        res.status(429).json(rateLimitConfig.privacy.stealthAddress.message);
      },
      skip: (req) => {
        const authReq = req as AuthenticatedRequest;
        return !authReq.user?.id;
      },
    });
  }

  /**
   * Create rate limiter for ZK proof verification endpoints
   * 10 proof verifications per minute per user
   */
  static createZkProofLimiter(): RateLimitRequestHandler {
    return rateLimit({
      windowMs: rateLimitConfig.privacy.zkProof.windowMs,
      max: rateLimitConfig.privacy.zkProof.max,
      message: rateLimitConfig.privacy.zkProof.message,
      standardHeaders: true,
      legacyHeaders: true,
      validate: false,
      keyGenerator: userKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler('zk-proof')(req, res);
        res.status(429).json(rateLimitConfig.privacy.zkProof.message);
      },
      skip: (req) => {
        const authReq = req as AuthenticatedRequest;
        return !authReq.user?.id;
      },
    });
  }

  /**
   * Create rate limiter for payment channel state updates
   * 1000 state updates per hour per channel
   */
  static createPaymentChannelStateUpdateLimiter(): RateLimitRequestHandler {
    return rateLimit({
      windowMs: rateLimitConfig.privacy.paymentChannel.stateUpdate.windowMs,
      max: rateLimitConfig.privacy.paymentChannel.stateUpdate.max,
      message: rateLimitConfig.privacy.paymentChannel.stateUpdate.message,
      standardHeaders: true,
      legacyHeaders: true,
      validate: false,
      keyGenerator: userKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler('payment-channel-state-update')(req, res);
        res.status(429).json(rateLimitConfig.privacy.paymentChannel.stateUpdate.message);
      },
      skip: (req) => {
        const authReq = req as AuthenticatedRequest;
        return !authReq.user?.id;
      },
    });
  }

  /**
   * Create rate limiter for selective disclosure proof generation
   * 20 disclosure proofs per day per user
   */
  static createSelectiveDisclosureLimiter(): RateLimitRequestHandler {
    return rateLimit({
      windowMs: rateLimitConfig.privacy.selectiveDisclosure.windowMs,
      max: rateLimitConfig.privacy.selectiveDisclosure.max,
      message: rateLimitConfig.privacy.selectiveDisclosure.message,
      standardHeaders: true,
      legacyHeaders: true,
      validate: false,
      keyGenerator: userKeyGenerator,
      store: this.redisStore || undefined,
      handler: (req, res, _next) => {
        createRateLimitHandler('selective-disclosure')(req, res);
        res.status(429).json(rateLimitConfig.privacy.selectiveDisclosure.message);
      },
      skip: (req) => {
        const authReq = req as AuthenticatedRequest;
        return !authReq.user?.id;
      },
    });
  }

  /**
   * Create rate limiter based on the authenticated user's subscription tier.
   * Free: 100 req/min, Pro: 500 req/min, Enterprise: 2000 req/min.
   * Uses a Redis sliding window counter when Redis is available.
   */
  static createSubscriptionTierLimiter(opts: TierRateLimiterOptions = {}): RequestHandler {
    return createSubscriptionTierLimiter(opts);
  }

  /**
   * Get Redis store status for health monitoring.
   * When `degraded` is true the app is running with the in-memory fallback
   * because Redis was configured but is currently unreachable.
   */
  static getStoreStatus(): { type: 'redis' | 'memory'; available: boolean; degraded: boolean } {
    const degraded = this.redisStoreInitialized && !this.redisStore;
    return {
      type: this.redisStore ? 'redis' : 'memory',
      available: this.redisStoreInitialized,
      degraded,
    };
  }
}

// Export individual limiter creators for convenience
export const createTeamInviteLimiter = () => RateLimiterFactory.createTeamInviteLimiter();
export const createMfaLimiter = () => RateLimiterFactory.createMfaLimiter();
export const createAdminLimiter = () => RateLimiterFactory.createAdminLimiter();
export const createSimulationLimiter = () => RateLimiterFactory.createSimulationLimiter();
export const createStealthAddressLimiter = () => RateLimiterFactory.createStealthAddressLimiter();
export const createZkProofLimiter = () => RateLimiterFactory.createZkProofLimiter();
export const createPaymentChannelStateUpdateLimiter = () => RateLimiterFactory.createPaymentChannelStateUpdateLimiter();
export const createSelectiveDisclosureLimiter = () => RateLimiterFactory.createSelectiveDisclosureLimiter();
export { createSubscriptionTierLimiter } from './subscription-tier-rate-limiter';