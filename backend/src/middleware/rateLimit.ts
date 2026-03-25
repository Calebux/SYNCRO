import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';
import logger from '../config/logger';

// --- Redis Client Setup ---
const redisUrl = process.env.REDIS_URL;
let redisClient: Redis | undefined;

if (redisUrl) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
    });
    redisClient.on('error', (err) => {
      logger.error('Redis connection error in rate limiter:', err);
    });
  } catch (err) {
    logger.error('Failed to initialize Redis client for rate limiter:', err);
  }
} else {
  logger.warn('REDIS_URL not provided. Rate limiting will use memory store and will not survive restarts.');
}

const store = redisClient 
  ? new RedisStore({
      // @ts-ignore - types can sometimes be finicky with different ioredis versions
      sendCommand: (...args: string[]) => redisClient!.call(...args),
    })
  : undefined;

// --- Rate Limiter Definitions ---

/**
 * Auth endpoints: 5 attempts per 15 minutes
 * Applied to /api/auth/*
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: store,
});

/**
 * API key creation: 10 keys per hour
 * Applied to POST /api/keys
 */
export const keyCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  // Use user ID if available, otherwise fallback to IP
  keyGenerator: (req: any) => req.user?.id ?? req.ip,
  message: { error: 'API key creation limit reached. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: store,
});

/**
 * Team invitations: 20 per hour
 * Applied to POST /api/team/invite
 */
export const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  // Use user ID if available, otherwise fallback to IP
  keyGenerator: (req: any) => req.user?.id ?? req.ip,
  message: { error: 'Invitation limit reached. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: store,
});
