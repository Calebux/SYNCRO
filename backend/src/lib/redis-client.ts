import { createClient, RedisClientType } from 'redis';
import logger from '../config/logger';
import { rateLimitConfig } from '../config/rate-limit';

/**
 * Shared Redis client for distributed locks, query caching, and metrics.
 * Reuses the same URL as rate limiting when available, otherwise REDIS_URL.
 */
export class SharedRedisClient {
  private static instance: SharedRedisClient | null = null;
  private client: RedisClientType | null = null;
  private isConnected = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): SharedRedisClient {
    if (!SharedRedisClient.instance) {
      SharedRedisClient.instance = new SharedRedisClient();
    }
    return SharedRedisClient.instance;
  }

  private resolveUrl(): string | undefined {
    return rateLimitConfig.redis.url || process.env.REDIS_URL;
  }

  async initialize(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    const url = this.resolveUrl();
    if (!url) {
      logger.info('[SharedRedisClient] No Redis URL configured');
      return;
    }

    this.initPromise = (async () => {
      try {
        this.client = createClient({
          url,
          socket: {
            reconnectStrategy: (retries) => Math.min(5000 * Math.pow(2, retries), 30000),
          },
        });

        this.client.on('connect', () => {
          this.isConnected = true;
          logger.info('[SharedRedisClient] Connected');
        });

        this.client.on('error', (error) => {
          this.isConnected = false;
          logger.error('[SharedRedisClient] Error:', error);
        });

        this.client.on('disconnect', () => {
          this.isConnected = false;
        });

        await this.client.connect();
      } catch (error) {
        logger.error('[SharedRedisClient] Failed to initialize:', error);
        this.client = null;
        this.isConnected = false;
        throw error;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async getClient(): Promise<RedisClientType | null> {
    if (!this.client || !this.isConnected) {
      try {
        await this.initialize();
      } catch {
        return null;
      }
    }
    return this.client;
  }

  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.disconnect().catch(() => undefined);
      this.client = null;
      this.isConnected = false;
    }
  }
}

export const sharedRedisClient = SharedRedisClient.getInstance();
