// src/middleware/rateLimiter.ts
import { Request, Response, NextFunction } from 'express';
import { createClient, RedisClientType } from 'redis';
import logger from '../config/logger';
import { env } from '../config/env';

const WINDOW_MS = 60000; // 1 minute window
const MAX_ATTEMPTS = 5;
const REDIS_KEY_PREFIX = 'rate:renewal:';

const counts = new Map<string, { count: number; lastReset: number }>();

const redisUrl = env.REDIS_URL || env.RATE_LIMIT_REDIS_URL;
let redisClient: RedisClientType | null = null;
let redisInitPromise: Promise<RedisClientType | null> | null = null;

async function initializeRedisClient(): Promise<RedisClientType | null> {
    if (!redisUrl) {
        logger.warn('REDIS_URL is not configured; renewal rate limiter will use in-memory fallback');
        return null;
    }

    if (redisInitPromise) {
        return redisInitPromise;
    }

    redisInitPromise = (async () => {
        try {
            const client = createClient({ url: redisUrl });

            client.on('connect', () => {
                logger.info('Renewal rate limiter Redis client connected');
            });

            client.on('error', (error) => {
                logger.error('Renewal rate limiter Redis error:', error);
            });

            await client.connect();
            redisClient = client;
            return client;
        } catch (error) {
            logger.error('Failed to initialize renewal rate limiter Redis client:', error);
            redisClient = null;
            return null;
        }
    })();

    return redisInitPromise;
}

async function getRedisClient(): Promise<RedisClientType | null> {
    if (redisClient) return redisClient;
    return initializeRedisClient();
}

export const renewalRateLimiter = async (req: Request, res: Response, next: NextFunction) => {
    const merchantId = req.params.id || req.body.id;
    if (!merchantId) return next();

    const redis = await getRedisClient();
    const key = `${REDIS_KEY_PREFIX}${merchantId}:${Math.floor(Date.now() / WINDOW_MS)}`;

    if (redis) {
        try {
            const count = await redis.incr(key);
            if (count === 1) {
                await redis.expire(key, Math.ceil(WINDOW_MS / 1000));
            }

            if (count > MAX_ATTEMPTS) {
                return res.status(429).json({
                    success: false,
                    error: 'Too many renewal/update attempts for this merchant. Please try again in a minute.',
                });
            }

            return next();
        } catch (error) {
            logger.warn('Redis rate limiter failed, falling back to in-memory store:', error);
        }
    }

    const now = Date.now();
    const record = counts.get(merchantId);

    if (!record || now - record.lastReset > WINDOW_MS) {
        counts.set(merchantId, { count: 1, lastReset: now });
        return next();
    }

    if (record.count >= MAX_ATTEMPTS) {
        return res.status(429).json({
            success: false,
            error: 'Too many renewal/update attempts for this merchant. Please try again in a minute.',
        });
    }

    record.count++;
    next();
};