import crypto from 'crypto';
import logger from '../config/logger';
import { sharedRedisClient } from '../lib/redis-client';

export interface QueryCacheMetrics {
  hits: number;
  misses: number;
  invalidations: number;
}

export interface QueryCacheOptions {
  ttlMs: number;
  namespace: string;
}

const METRICS_PREFIX = 'query_cache:metrics:';
const KEY_PREFIX = 'query_cache:';

/**
 * Redis-backed query result cache with per-user key isolation (RLS-safe).
 */
export class QueryCacheService {
  private readonly enabled: boolean;
  private inMemoryMetrics: QueryCacheMetrics = { hits: 0, misses: 0, invalidations: 0 };

  constructor() {
    this.enabled = process.env.QUERY_CACHE_ENABLED !== 'false';
  }

  private cacheKey(userId: string, namespace: string, queryHash: string): string {
    return `${KEY_PREFIX}${namespace}:${userId}:${queryHash}`;
  }

  private hashQuery(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  }

  private async incrementMetric(field: keyof QueryCacheMetrics): Promise<void> {
    this.inMemoryMetrics[field]++;

    const client = await sharedRedisClient.getClient();
    if (!client) return;

    try {
      await client.incr(`${METRICS_PREFIX}${field}`);
    } catch (error) {
      logger.warn('[QueryCache] Failed to increment metric', { field, error });
    }
  }

  async get<T>(userId: string, namespace: string, queryPayload: unknown): Promise<T | null> {
    if (!this.enabled) return null;

    const client = await sharedRedisClient.getClient();
    if (!client) return null;

    const key = this.cacheKey(userId, namespace, this.hashQuery(queryPayload));

    try {
      const raw = await client.get(key);
      if (raw) {
        await this.incrementMetric('hits');
        return JSON.parse(raw) as T;
      }
      await this.incrementMetric('misses');
      return null;
    } catch (error) {
      logger.warn('[QueryCache] Get failed', { namespace, error });
      return null;
    }
  }

  async set<T>(
    userId: string,
    namespace: string,
    queryPayload: unknown,
    value: T,
    ttlMs: number,
  ): Promise<void> {
    if (!this.enabled) return;

    const client = await sharedRedisClient.getClient();
    if (!client) return;

    const key = this.cacheKey(userId, namespace, this.hashQuery(queryPayload));
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    try {
      await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (error) {
      logger.warn('[QueryCache] Set failed', { namespace, error });
    }
  }

  /**
   * Invalidate all cached entries for a user within a namespace.
   */
  async invalidateUserNamespace(userId: string, namespace: string): Promise<void> {
    const client = await sharedRedisClient.getClient();
    if (!client) return;

    const pattern = `${KEY_PREFIX}${namespace}:${userId}:*`;

    try {
      let cursor = '0';
      do {
        const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          await client.del(result.keys);
        }
      } while (cursor !== '0');

      await this.incrementMetric('invalidations');
    } catch (error) {
      logger.warn('[QueryCache] Invalidation failed', { namespace, userId, error });
    }
  }

  async getMetrics(): Promise<QueryCacheMetrics> {
    const client = await sharedRedisClient.getClient();
    if (!client) {
      return { ...this.inMemoryMetrics };
    }

    const fields: Array<keyof QueryCacheMetrics> = ['hits', 'misses', 'invalidations'];
    const values = await Promise.all(
      fields.map(async (field) => {
        const val = await client.get(`${METRICS_PREFIX}${field}`);
        return parseInt(val ?? String(this.inMemoryMetrics[field]), 10) || 0;
      }),
    );

    return {
      hits: values[0],
      misses: values[1],
      invalidations: values[2],
    };
  }

  getDefaultSubscriptionListTtl(): number {
    return parseInt(process.env.QUERY_CACHE_SUBSCRIPTION_LIST_TTL_MS ?? '60000', 10) || 60_000;
  }

  getDefaultAnalyticsTtl(): number {
    return parseInt(process.env.QUERY_CACHE_ANALYTICS_TTL_MS ?? '300000', 10) || 300_000;
  }
}

export const queryCacheService = new QueryCacheService();
