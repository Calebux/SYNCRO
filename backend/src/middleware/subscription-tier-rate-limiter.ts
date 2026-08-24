import { Request, Response, NextFunction } from 'express';
import { createClient, RedisClientType } from 'redis';
import { supabase, databaseRepository } from '../config/database';
import logger from '../config/logger';
import { AuthenticatedRequest } from './auth';
import { SubscriptionTier, TIER_RATE_LIMIT_CONFIG } from '../config/rate-limit';

const REDIS_URL = process.env.REDIS_URL || process.env.RATE_LIMIT_REDIS_URL;
const TIER_CACHE_TTL_S = 300; // cache tier lookups for 5 minutes

let redisClient: RedisClientType | null = null;

async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisClient) return redisClient;
  if (!REDIS_URL) return null;
  try {
    const client = createClient({ url: REDIS_URL });
    client.on('error', (err) => logger.error('Tier rate limiter Redis error:', err));
    await client.connect();
    redisClient = client;
    return client;
  } catch (err) {
    logger.warn('Tier rate limiter: Redis unavailable, falling back to in-memory:', err);
    return null;
  }
}

// In-memory fallbacks
const tierCache = new Map<string, { tier: SubscriptionTier; expiresAt: number }>();
const inMemoryCounters = new Map<string, number[]>();

function normalizeToTier(raw: string | null | undefined): SubscriptionTier {
  if (!raw) return 'free';
  const lower = raw.toLowerCase();
  if (lower.includes('enterprise')) return 'enterprise';
  if (lower.includes('pro') || lower.includes('premium') || lower.includes('plus')) return 'pro';
  return 'free';
}

async function getUserTier(userId: string, redis: RedisClientType | null): Promise<SubscriptionTier> {
  const cacheKey = `tier_cache:${userId}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return cached as SubscriptionTier;
    } catch {
      // fall through to DB lookup
    }
  } else {
    const mem = tierCache.get(userId);
    if (mem && mem.expiresAt > Date.now()) return mem.tier;
  }

  const { data } = await databaseRepository
    .from('profiles')
    .select('subscription_tier')
    .eq('id', userId)
    .maybeSingle();

  const tier = normalizeToTier(data?.subscription_tier);

  if (redis) {
    try {
      await redis.set(cacheKey, tier, { EX: TIER_CACHE_TTL_S });
    } catch { /* non-fatal */ }
  } else {
    tierCache.set(userId, { tier, expiresAt: Date.now() + TIER_CACHE_TTL_S * 1000 });
  }

  return tier;
}

async function slidingWindowCheck(
  userId: string,
  tier: SubscriptionTier,
  limit: number,
  windowMs: number,
  redis: RedisClientType | null,
): Promise<{ allowed: boolean; remaining: number; resetAt: number; total: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;
  const resetAt = Math.ceil((now + windowMs) / 1000);

  if (redis) {
    const key = `tier_rl:${tier}:${userId}`;
    try {
      await redis.zRemRangeByScore(key, '-inf', String(windowStart));
      const count = await redis.zCard(key);
      if (count < limit) {
        await redis.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
        await redis.pExpire(key, windowMs);
        return { allowed: true, remaining: limit - count - 1, resetAt, total: limit };
      }
      return { allowed: false, remaining: 0, resetAt, total: limit };
    } catch (err) {
      logger.warn('Tier rate limiter: Redis sliding window failed, allowing request:', err);
      return { allowed: true, remaining: limit, resetAt, total: limit };
    }
  }

  // In-memory sliding window fallback
  const key = `${tier}:${userId}`;
  const timestamps = (inMemoryCounters.get(key) ?? []).filter((t) => t > windowStart);
  if (timestamps.length < limit) {
    timestamps.push(now);
    inMemoryCounters.set(key, timestamps);
    return { allowed: true, remaining: limit - timestamps.length, resetAt, total: limit };
  }
  return { allowed: false, remaining: 0, resetAt, total: limit };
}

export interface TierRateLimiterOptions {
  sensitive?: boolean;
}

export function createSubscriptionTierLimiter(opts: TierRateLimiterOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      next();
      return;
    }

    const redis = await getRedisClient();
    let tier: SubscriptionTier = 'free';

    try {
      tier = await getUserTier(userId, redis);
    } catch (err) {
      logger.warn('Tier rate limiter: failed to get user tier, defaulting to free:', err);
    }

    const { windowMs, limits, sensitiveMultiplier } = TIER_RATE_LIMIT_CONFIG;
    const baseLimit = limits[tier];
    const limit = opts.sensitive ? Math.max(1, Math.floor(baseLimit * sensitiveMultiplier)) : baseLimit;

    const { allowed, remaining, resetAt, total } = await slidingWindowCheck(
      userId,
      tier,
      limit,
      windowMs,
      redis,
    );

    res.set({
      'X-RateLimit-Limit': String(total),
      'X-RateLimit-Remaining': String(Math.max(0, remaining)),
      'X-RateLimit-Reset': String(resetAt),
      'X-RateLimit-Policy': `${total};w=${Math.floor(windowMs / 1000)}`,
    });

    if (!allowed) {
      const retryAfter = resetAt - Math.floor(Date.now() / 1000);
      res.set('Retry-After', String(retryAfter));

      logger.warn('Subscription tier rate limit exceeded', {
        userId,
        tier,
        limit,
        path: req.path,
        method: req.method,
        sensitive: opts.sensitive ?? false,
      });

      res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded for ${tier} tier (${total} req/min). Retry after ${retryAfter}s.`,
        retryAfter,
      });
      return;
    }

    next();
  };
}
