import { randomUUID } from 'crypto';
import logger from '../config/logger';
import { sharedRedisClient } from './redis-client';

export interface LockAcquireResult {
  acquired: boolean;
  lockToken?: string;
  reason?: 'contention' | 'unavailable';
}

export interface LockMetricsSnapshot {
  acquired: number;
  contention: number;
  released: number;
  expired: number;
}

const METRICS_PREFIX = 'renewal_lock:metrics:';

/**
 * Redis-based distributed lock using SET NX with TTL.
 * Default TTL: 5 minutes (300 seconds).
 */
export class RedisDistributedLock {
  private readonly keyPrefix = 'renewal_lock:';
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = 5 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  private lockKey(subscriptionId: string, cycleId: number): string {
    return `${this.keyPrefix}${subscriptionId}:${cycleId}`;
  }

  private async incrementMetric(field: 'acquired' | 'contention' | 'released' | 'expired'): Promise<void> {
    const client = await sharedRedisClient.getClient();
    if (!client) return;
    try {
      await client.incr(`${METRICS_PREFIX}${field}`);
    } catch (error) {
      logger.warn('[RedisDistributedLock] Failed to increment metric', { field, error });
    }
  }

  async acquire(
    subscriptionId: string,
    cycleId: number,
    ttlMs: number = this.defaultTtlMs,
  ): Promise<LockAcquireResult> {
    const client = await sharedRedisClient.getClient();
    if (!client) {
      logger.warn('[RedisDistributedLock] Redis unavailable, lock not acquired');
      return { acquired: false, reason: 'unavailable' };
    }

    const token = randomUUID();
    const key = this.lockKey(subscriptionId, cycleId);
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    try {
      const result = await client.set(key, token, { NX: true, EX: ttlSeconds });
      if (result === 'OK') {
        await this.incrementMetric('acquired');
        logger.info('[RedisDistributedLock] Lock acquired', { subscriptionId, cycleId, ttlSeconds });
        return { acquired: true, lockToken: token };
      }

      await this.incrementMetric('contention');
      logger.warn('[RedisDistributedLock] Lock contention', { subscriptionId, cycleId });
      return { acquired: false, reason: 'contention' };
    } catch (error) {
      logger.error('[RedisDistributedLock] Acquire failed', { subscriptionId, cycleId, error });
      return { acquired: false, reason: 'unavailable' };
    }
  }

  /**
   * Release lock only if we still hold it (compare token via Lua script).
   */
  async release(subscriptionId: string, cycleId: number, lockToken: string): Promise<boolean> {
    const client = await sharedRedisClient.getClient();
    if (!client) return false;

    const key = this.lockKey(subscriptionId, cycleId);
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await client.eval(script, { keys: [key], arguments: [lockToken] });
      if (result === 1) {
        await this.incrementMetric('released');
        logger.info('[RedisDistributedLock] Lock released', { subscriptionId, cycleId });
        return true;
      }
      await this.incrementMetric('expired');
      return false;
    } catch (error) {
      logger.error('[RedisDistributedLock] Release failed', { subscriptionId, cycleId, error });
      return false;
    }
  }

  async getMetrics(): Promise<LockMetricsSnapshot> {
    const client = await sharedRedisClient.getClient();
    if (!client) {
      return { acquired: 0, contention: 0, released: 0, expired: 0 };
    }

    const fields: Array<keyof LockMetricsSnapshot> = ['acquired', 'contention', 'released', 'expired'];
    const values = await Promise.all(
      fields.map(async (field) => {
        const val = await client.get(`${METRICS_PREFIX}${field}`);
        return parseInt(val ?? '0', 10) || 0;
      }),
    );

    return {
      acquired: values[0],
      contention: values[1],
      released: values[2],
      expired: values[3],
    };
  }
}

export const redisDistributedLock = new RedisDistributedLock(
  parseInt(process.env.RENEWAL_LOCK_TTL_MS ?? '300000', 10) || 5 * 60 * 1000,
);
