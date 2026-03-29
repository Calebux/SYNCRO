import { RedisStore } from 'rate-limit-redis';
import { createClient, RedisClientType } from 'redis';
import logger from '../config/logger';
import { rateLimitConfig } from '../config/rate-limit';

export class RateLimitRedisStore {
  private static instance: RateLimitRedisStore | null = null;
  private client: RedisClientType | null = null;
  private store: RedisStore | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 5000; // 5 seconds

  private constructor() {}

  /**
   * Get singleton instance of Redis store
   */
  static getInstance(): RateLimitRedisStore {
    if (!RateLimitRedisStore.instance) {
      RateLimitRedisStore.instance = new RateLimitRedisStore();
    }
    return RateLimitRedisStore.instance;
  }

  /**
   * Initialize Redis connection and store
   */
  async initialize(): Promise<void> {
    if (!rateLimitConfig.redis.enabled || !rateLimitConfig.redis.url) {
      logger.info('Redis rate limiting disabled - using memory store fallback');
      return;
    }

    try {
      this.client = createClient({
        url: rateLimitConfig.redis.url,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries >= this.maxReconnectAttempts) {
              logger.error('Redis max reconnection attempts reached, falling back to memory store');
              return false;
            }
            const delay = Math.min(this.reconnectDelay * Math.pow(2, retries), 30000);
            logger.warn(`Redis reconnection attempt ${retries + 1}/${this.maxReconnectAttempts} in ${delay}ms`);
            return delay;
          },
        },
      });

      // Set up event handlers
      this.client.on('connect', () => {
        logger.info('Redis client connected for rate limiting');
        this.isConnected = true;
        this.reconnectAttempts = 0;
      });

      this.client.on('error', (error) => {
        logger.error('Redis client error:', error);
        this.isConnected = false;
      });

      this.client.on('disconnect', () => {
        logger.warn('Redis client disconnected');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        this.reconnectAttempts++;
        logger.info(`Redis client reconnecting (attempt ${this.reconnectAttempts})`);
      });

      // Connect to Redis
      await this.client.connect();

      // Create the rate limit store
      this.store = new RedisStore({
        sendCommand: (...args: string[]) => this.client!.sendCommand(args),
        prefix: 'rate_limit:',
      });

      logger.info('Redis rate limiting store initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Redis rate limiting store:', error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Get the Redis store instance (null if not available)
   */
  getStore(): RedisStore | null {
    if (!this.isConnected || !this.store) {
      return null;
    }
    return this.store;
  }

  /**
   * Check if Redis is available and connected
   */
  isAvailable(): boolean {
    return this.isConnected && this.store !== null;
  }

  /**
   * Get Redis connection health status
   */
  getHealthStatus(): { connected: boolean; reconnectAttempts: number; error?: string } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      error: this.isConnected ? undefined : 'Redis connection unavailable',
    };
  }

  /**
   * Cleanup Redis connection
   */
  private cleanup(): void {
    if (this.client) {
      this.client.removeAllListeners();
      this.client.disconnect().catch((error) => {
        logger.error('Error disconnecting Redis client:', error);
      });
      this.client = null;
    }
    this.store = null;
    this.isConnected = false;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Redis rate limiting store');
    this.cleanup();
  }
}

/**
 * Factory function to create Redis store with error handling
 */
export async function createRedisStore(): Promise<RedisStore | undefined> {
  if (!rateLimitConfig.redis.enabled) {
    logger.info('Redis rate limiting disabled by configuration');
    return undefined;
  }

  try {
    const redisStore = RateLimitRedisStore.getInstance();
    await redisStore.initialize();
    return redisStore.getStore() || undefined;
  } catch (error) {
    logger.warn('Redis store initialization failed, falling back to memory store:', error);
    return undefined;
  }
}

// Export singleton instance for health monitoring
export const redisStoreInstance = RateLimitRedisStore.getInstance();