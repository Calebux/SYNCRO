import { createClient, type RedisClientType } from 'redis';
import logger from '../config/logger';
import { rateLimitConfig } from '../config/rate-limit';

const CURSOR_PREFIX = 'syncro:stealth-scan:cursor:';
const memoryCursors = new Map<string, string>();

let redisClient: RedisClientType | null = null;
let redisReady = false;

async function getRedis(): Promise<RedisClientType | null> {
  if (!rateLimitConfig.redis.enabled || !rateLimitConfig.redis.url) return null;
  if (redisClient && redisReady) return redisClient;

  try {
    redisClient = createClient({ url: rateLimitConfig.redis.url });
    redisClient.on('error', (err) => logger.warn('Scan cursor Redis error', { err }));
    await redisClient.connect();
    redisReady = true;
    return redisClient;
  } catch (err) {
    logger.warn('Scan cursor Redis unavailable, using memory fallback', { err });
    return null;
  }
}

export async function getScanCursor(userId: string): Promise<string | null> {
  const redis = await getRedis();
  if (redis) {
    return redis.get(`${CURSOR_PREFIX}${userId}`);
  }
  return memoryCursors.get(userId) ?? null;
}

export async function setScanCursor(userId: string, cursor: string): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    await redis.set(`${CURSOR_PREFIX}${userId}`, cursor);
    return;
  }
  memoryCursors.set(userId, cursor);
}

export function _resetScanCursorStoreForTests(): void {
  memoryCursors.clear();
  redisReady = false;
  redisClient = null;
}
