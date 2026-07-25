import { createClient, RedisClientType } from 'redis';
import logger from '../../config/logger';

export class RedisCacheAdapter {
  private client: RedisClientType | null = null;
  private isReady = false;
  private readonly ttlSeconds: number;

  constructor(ttlSeconds: number = 900) { // 15 minutes default
    this.ttlSeconds = ttlSeconds;
    const url = process.env.REDIS_URL;
    if (url) {
      this.client = createClient({ url }) as RedisClientType;
      this.client.on('error', (err: Error) =>
        logger.warn('Redis cache error', { err: err.message }),
      );
      this.client.on('ready', () => { this.isReady = true; });
      this.client.on('end', () => { this.isReady = false; });
      this.client
        .connect()
        .then(() => { this.isReady = true; })
        .catch((err: Error) =>
          logger.warn('Redis cache connection failed', { err: err.message }),
        );
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.isReady) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.client || !this.isReady) return;
    try {
      await this.client.setEx(key, this.ttlSeconds, value);
    } catch { /* ignore */ }
  }
}
