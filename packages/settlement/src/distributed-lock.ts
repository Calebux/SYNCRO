/**
 * Redis-based distributed lock for channel lifecycle operations.
 *
 * Provides a generic locking mechanism that works across multiple backend instances
 * to prevent race conditions when opening channels or performing top-ups.
 */

import { randomUUID } from 'crypto';
import type { RedisClientType } from 'redis';

export interface LockAcquireResult {
  acquired: boolean;
  lockToken?: string;
  reason?: 'contention' | 'unavailable';
}

export interface LockOptions {
  /** Lock key prefix (e.g., 'channel_lock:') */
  keyPrefix: string;
  /** Default TTL in milliseconds */
  defaultTtlMs: number;
  /** Redis client getter */
  getClient: () => Promise<RedisClientType | null>;
}

/**
 * Generic Redis-based distributed lock using SET NX with TTL.
 * Can be used for any resource that needs distributed coordination.
 */
export class DistributedLock {
  private readonly keyPrefix: string;
  private readonly defaultTtlMs: number;
  private readonly getClient: () => Promise<RedisClientType | null>;

  constructor(options: LockOptions) {
    this.keyPrefix = options.keyPrefix;
    this.defaultTtlMs = options.defaultTtlMs;
    this.getClient = options.getClient;
  }

  private lockKey(resourceKey: string): string {
    return `${this.keyPrefix}${resourceKey}`;
  }

  /**
   * Acquire a distributed lock for the given resource.
   * @param resourceKey - Unique identifier for the resource (e.g., "principal::provider")
   * @param ttlMs - Time-to-live in milliseconds (default: 5 minutes)
   * @returns LockAcquireResult with acquired status and token if successful
   */
  async acquire(
    resourceKey: string,
    ttlMs: number = this.defaultTtlMs,
  ): Promise<LockAcquireResult> {
    const client = await this.getClient();
    if (!client) {
      return { acquired: false, reason: 'unavailable' };
    }

    const token = randomUUID();
    const key = this.lockKey(resourceKey);
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    try {
      const result = await client.set(key, token, { NX: true, EX: ttlSeconds });
      if (result === 'OK') {
        return { acquired: true, lockToken: token };
      }
      return { acquired: false, reason: 'contention' };
    } catch (error) {
      // Log error but don't throw - treat as unavailable
      return { acquired: false, reason: 'unavailable' };
    }
  }

  /**
   * Release a lock only if we still hold it (compare token via Lua script).
   * @param resourceKey - The resource key used when acquiring the lock
   * @param lockToken - The token returned from acquire()
   * @returns true if lock was released, false if we didn't hold it or it expired
   */
  async release(resourceKey: string, lockToken: string): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;

    const key = this.lockKey(resourceKey);
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await client.eval(script, { keys: [key], arguments: [lockToken] });
      return result === 1;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extend the TTL of an existing lock we hold.
   * @param resourceKey - The resource key
   * @param lockToken - The token returned from acquire()
   * @param ttlMs - New TTL in milliseconds
   * @returns true if extended, false if we didn't hold it or it expired
   */
  async extend(resourceKey: string, lockToken: string, ttlMs: number): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;

    const key = this.lockKey(resourceKey);
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("expire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    try {
      const result = await client.eval(script, {
        keys: [key],
        arguments: [lockToken, ttlSeconds.toString()],
      });
      return result === 1;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Creates a channel-specific distributed lock using the shared Redis client.
 * This is the default lock instance for channel operations.
 */
export function createChannelLock(
  getClient: () => Promise<RedisClientType | null>,
  defaultTtlMs = 5 * 60 * 1000, // 5 minutes default
): DistributedLock {
  return new DistributedLock({
    keyPrefix: 'channel_lock:',
    defaultTtlMs,
    getClient,
  });
}