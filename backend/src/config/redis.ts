import { createClient, RedisClientType } from 'redis';
import logger from './logger';

const REDIS_URL = process.env.REDIS_URL;

let redis: RedisClientType | null = null;

if (REDIS_URL) {
  redis = createClient({ url: REDIS_URL }) as RedisClientType;

  redis.on('error', (err) => {
    logger.warn('Redis client error:', err);
  });

  redis.connect().catch((err) => {
    logger.warn('Redis connection failed:', err);
  });
} else {
  logger.warn('REDIS_URL not set; Redis client not initialised');
}

export { redis };
