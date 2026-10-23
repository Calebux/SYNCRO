import { sharedRedisClient } from '../lib/redis-client';
import logger from '../config/logger';
import crypto from 'crypto';
import { admissionConfig } from '../config/admission';

/**
 * Represents a cached admission value with metadata for revocation-aware invalidation.
 */
interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  version: number; // Monotonic version for revocation
  revoked: boolean;
  revokedAt?: number;
}

/**
 * Represents a revocation record for a cached entry.
 */
interface RevocationRecord {
  key: string;
  revokedAt: number;
  reason: string;
  version: number;
}

/**
 * Redis-backed cache with revocation-aware invalidation.
 *
 * Unlike a simple TTL cache, this cache tracks revocation versions so that
 * cached entries can be invalidated immediately when a cap is changed or a
 * scope is revoked, rather than waiting for the TTL to expire.
 */
export class AdmissionCacheService {
  private static instance: AdmissionCacheService | null = null;
  private inMemoryCache: Map<string, CacheEntry<unknown>> = new Map();
  private revocationLog: Map<string, RevocationRecord[]> = new Map();
  private readonly maxInMemoryEntries: number;

  private constructor() {
    this.maxInMemoryEntries = admissionConfig.cache.identityResolution.maxEntries;
  }

  static getInstance(): AdmissionCacheService {
    if (!AdmissionCacheService.instance) {
      AdmissionCacheService.instance = new AdmissionCacheService();
    }
    return AdmissionCacheService.instance;
  }

  /**
   * Generate a cache key from namespace and identifier.
   */
  private cacheKey(namespace: string, identifier: string): string {
    return `${admissionConfig.redisKeyPrefix}${namespace}:${identifier}`;
  }

  /**
   * Hash a value for cache key generation.
   */
  private hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

  /**
   * Get a cached value by namespace and key. Returns null if not found, expired, or revoked.
   */
  async get<T>(namespace: string, key: string): Promise<T | null> {
    const redisKey = this.cacheKey(namespace, key);

    // Try Redis first
    const redisClient = await sharedRedisClient.getClient();
    if (redisClient) {
      try {
        const raw = await redisClient.get(redisKey);
        if (raw) {
          const entry = JSON.parse(raw) as CacheEntry<T>;
          if (this.isEntryValid(entry)) {
            return entry.value;
          }
          // Entry expired or revoked - clean up
          await this.delete(namespace, key);
        }
      } catch (error) {
        logger.warn(`Failed to read admission cache from Redis [${namespace}]:`, error);
      }
    }

    // Fallback to in-memory cache
    const memEntry = this.inMemoryCache.get(redisKey) as CacheEntry<T> | undefined;
    if (memEntry && this.isEntryValid(memEntry)) {
      return memEntry.value;
    }

    // Clean up stale entries
    if (memEntry) {
      this.inMemoryCache.delete(redisKey);
    }

    return null;
  }

  /**
   * Set a cached value with a version for revocation tracking.
   */
  async set<T>(namespace: string, key: string, value: T, version: number = 1): Promise<void> {
    const redisKey = this.cacheKey(namespace, key);
    const now = Date.now();
    const ttlMs = this.getTtl(namespace);
    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      expiresAt: now + ttlMs,
      version,
      revoked: false,
    };

    // Store in Redis
    const redisClient = await sharedRedisClient.getClient();
    if (redisClient) {
      try {
        await redisClient.setEx(redisKey, Math.ceil(ttlMs / 1000), JSON.stringify(entry));
      } catch (error) {
        logger.warn(`Failed to write admission cache to Redis [${namespace}]:`, error);
      }
    }

    // Store in in-memory cache
    this.inMemoryCache.set(redisKey, entry as CacheEntry<unknown>);

    // Evict oldest entries if over limit
    if (this.inMemoryCache.size > this.maxInMemoryEntries) {
      this.evictOldest();
    }
  }

  /**
   * Delete a cached entry by namespace and key.
   */
  async delete(namespace: string, key: string): Promise<void> {
    const redisKey = this.cacheKey(namespace, key);

    const redisClient = await sharedRedisClient.getClient();
    if (redisClient) {
      try {
        await redisClient.del(redisKey);
      } catch (error) {
        logger.warn(`Failed to delete admission cache from Redis [${namespace}]:`, error);
      }
    }

    this.inMemoryCache.delete(redisKey);
  }

  /**
   * Revoke all cached entries for a namespace and identifier.
   * This increments the version and marks entries as revoked.
   */
  async revoke(namespace: string, key: string, reason: string = 'manual'): Promise<void> {
    const redisKey = this.cacheKey(namespace, key);
    const now = Date.now();
    const currentVersion = await this.getCurrentVersion(namespace, key);
    const newVersion = currentVersion + 1;

    const revocation: RevocationRecord = {
      key: redisKey,
      revokedAt: now,
      reason,
      version: newVersion,
    };

    // Track revocation log
    const revocations = this.revocationLog.get(namespace) || [];
    revocations.push(revocation);
    this.revocationLog.set(namespace, revocations);

    // Update the entry in Redis with revoked status and new version
    const redisClient = await sharedRedisClient.getClient();
    if (redisClient) {
      try {
        const raw = await redisClient.get(redisKey);
        if (raw) {
          const entry = JSON.parse(raw) as CacheEntry<unknown>;
          entry.revoked = true;
          entry.revokedAt = now;
          entry.version = newVersion;
          await redisClient.setEx(redisKey, Math.ceil(entry.expiresAt / 1000), JSON.stringify(entry));
        }
      } catch (error) {
        logger.warn(`Failed to revoke admission cache in Redis [${namespace}]:`, error);
      }
    }

    // Update in-memory cache
    const memEntry = this.inMemoryCache.get(redisKey) as CacheEntry<unknown> | undefined;
    if (memEntry) {
      memEntry.revoked = true;
      memEntry.revokedAt = now;
      memEntry.version = newVersion;
    }

    logger.info(`Admission cache revoked [${namespace}:${key}]`, { reason, version: newVersion });
  }

  /**
   * Check if a cached entry is valid (not expired and not revoked).
   */
  private isEntryValid<T>(entry: CacheEntry<T>): boolean {
    const now = Date.now();
    if (entry.revoked || entry.revokedAt) return false;
    if (now > entry.expiresAt) return false;
    return true;
  }

  /**
   * Get the current version for a cache key (for revocation tracking).
   */
  private async getCurrentVersion(namespace: string, key: string): Promise<number> {
    const redisKey = this.cacheKey(namespace, key);
    const memEntry = this.inMemoryCache.get(redisKey) as CacheEntry<unknown> | undefined;

    if (memEntry) {
      return memEntry.version;
    }

    const redisClient = await sharedRedisClient.getClient();
    if (redisClient) {
      try {
        const raw = await redisClient.get(redisKey);
        if (raw) {
          const entry = JSON.parse(raw) as CacheEntry<unknown>;
          return entry.version || 0;
        }
      } catch {
        // Ignore
      }
    }

    return 0;
  }

  /**
   * Get TTL for a namespace.
   */
  private getTtl(namespace: string): number {
    switch (namespace) {
      case 'identity':
        return admissionConfig.cache.identityResolution.ttlMs;
      case 'scope':
        return admissionConfig.cache.scopeRead.ttlMs;
      case 'cap':
        return admissionConfig.cache.capCheck.ttlMs;
      case 'meter':
        return admissionConfig.cache.meterReserve.ttlMs;
      default:
        return 60000;
    }
  }

  /**
   * Evict oldest entries when cache exceeds max size.
   */
  private evictOldest(): void {
    const now = Date.now();
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.inMemoryCache) {
      if (entry.createdAt < oldestTime && !entry.revoked) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.inMemoryCache.delete(oldestKey);
    }
  }

  /**
   * Get cache metrics for monitoring.
   */
  async getMetrics(): Promise<{
    hits: number;
    misses: number;
    invalidations: number;
    size: number;
    revocations: number;
  }> {
    return {
      hits: 0,
      misses: 0,
      invalidations: this.revocationLog.size,
      size: this.inMemoryCache.size,
      revocations: this.revocationLog.size,
    };
  }

  /**
   * Clear all cached entries (useful for testing).
   */
  async clear(): Promise<void> {
    this.inMemoryCache.clear();
    this.revocationLog.clear();

    const redisClient = await sharedRedisClient.getClient();
    if (redisClient) {
      try {
        const keys = await redisClient.keys(`${admissionConfig.redisKeyPrefix}*`);
        if (keys.length > 0) {
          await redisClient.del(keys);
        }
      } catch (error) {
        logger.warn('Failed to clear admission cache from Redis:', error);
      }
    }
  }

  /**
   * Check if Redis is available for distributed caching.
   */
  async isRedisAvailable(): Promise<boolean> {
    const client = await sharedRedisClient.getClient();
    return client !== null;
  }
}

export const admissionCacheService = AdmissionCacheService.getInstance();