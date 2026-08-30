import { createClient, RedisClientType } from 'redis';
import logger from '../../config/logger';
import { env } from '../../config/env';

/**
 * Default jitter factor: up to 10 % added to any TTL so that multiple
 * backend instances don't all expire their caches simultaneously.
 * Overridden by EXCHANGE_RATE_CACHE_JITTER_FACTOR (0 – 1).
 */
const DEFAULT_JITTER_FACTOR = 0.1;

function getJitterFactor(): number {
  const envVal = env.EXCHANGE_RATE_CACHE_JITTER_FACTOR;
  if (envVal !== undefined) {
    const v = parseFloat(envVal);
    if (!isNaN(v) && v >= 0 && v <= 1) return v;
  }
  return DEFAULT_JITTER_FACTOR;
}

/**
 * Stale-while-revalidate window as a multiple of the base TTL.
 * A value of 0.5 means data remains "stale-but-serveable" for an extra 50 %
 * of the base TTL after the live window has closed.
 * Overridden by EXCHANGE_RATE_CACHE_SWR_FACTOR (≥ 0).
 */
const DEFAULT_SWR_FACTOR = 0.5;

function getSwrFactor(): number {
  const envVal = env.EXCHANGE_RATE_CACHE_SWR_FACTOR;
  if (envVal !== undefined) {
    const v = parseFloat(envVal);
    if (!isNaN(v) && v >= 0) return v;
  }
  return DEFAULT_SWR_FACTOR;
}

export interface CacheEntry {
  value: string;
  /** Unix ms when the entry was written. */
  storedAt: number;
  /** Live TTL in milliseconds (without jitter applied). */
  liveTtlMs: number;
}

export type CacheGetResult =
  | { status: 'hit'; value: string }
  | { status: 'stale'; value: string }
  | { status: 'miss' };

export interface CacheMetrics {
  hits: number;
  staleHits: number;
  misses: number;
  /** hit-rate as a fraction in [0, 1]. Returns NaN when no requests recorded. */
  readonly hitRate: number;
}

/**
 * Redis-backed cache adapter used by ExchangeRateService and MerchantService.
 *
 * Features:
 *  - **Jittered TTL**: each entry's Redis TTL is extended by a random fraction
 *    of the base TTL so that large deployments don't stampede the upstream APIs
 *    at the same moment.
 *  - **Stale-while-revalidate (SWR)**: after the live window closes the entry
 *    is kept for an additional SWR window.  Callers receive `status: 'stale'`
 *    and should trigger a background revalidation.
 *  - **Hit/miss metrics**: `getMetrics()` returns counters and the derived
 *    hit-rate fraction.  Metrics are kept in-process; they reset on restart.
 */
export class RedisCacheAdapter {
  private client: RedisClientType | null = null;
  private isReady = false;
  private readonly baseTtlSeconds: number;
  private readonly jitterFactor: number;
  private readonly swrFactor: number;

  private metrics: CacheMetrics = {
    hits: 0,
    staleHits: 0,
    misses: 0,
    get hitRate() {
      const total = this.hits + this.staleHits + this.misses;
      return total === 0 ? NaN : this.hits / total;
    },
  };

  constructor(
    baseTtlSeconds: number = 900,
    jitterFactor?: number,
    swrFactor?: number,
  ) {
    this.baseTtlSeconds = baseTtlSeconds;
    this.jitterFactor = jitterFactor ?? getJitterFactor();
    this.swrFactor = swrFactor ?? getSwrFactor();

    const url = env.REDIS_URL;
    if (url) {
      this.client = createClient({ url }) as RedisClientType;
      this.client.on('error', (err: Error) =>
        logger.warn('Redis cache error', { err: err.message }),
      );
      this.client.on('ready', () => {
        this.isReady = true;
      });
      this.client.on('end', () => {
        this.isReady = false;
      });
      this.client
        .connect()
        .then(() => {
          this.isReady = true;
        })
        .catch((err: Error) =>
          logger.warn('Redis cache connection failed', { err: err.message }),
        );
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Retrieve an entry and classify it as a live hit, a stale hit, or a miss.
   * Updates in-process metrics on every call.
   */
  async getWithStatus(key: string): Promise<CacheGetResult> {
    if (!this.client || !this.isReady) {
      this.metrics.misses++;
      return { status: 'miss' };
    }

    try {
      const raw = await this.client.get(key);
      if (!raw) {
        this.metrics.misses++;
        return { status: 'miss' };
      }

      const entry = this.parseCacheEntry(raw);
      if (!entry) {
        // Unparseable legacy value — treat as a live hit so callers still get data
        this.metrics.hits++;
        return { status: 'hit', value: raw };
      }

      const ageMs = Date.now() - entry.storedAt;
      const liveTtlMs = entry.liveTtlMs;

      if (ageMs <= liveTtlMs) {
        this.metrics.hits++;
        return { status: 'hit', value: entry.value };
      }

      // Within SWR window?
      const swrWindowMs = liveTtlMs * this.swrFactor;
      if (ageMs <= liveTtlMs + swrWindowMs) {
        this.metrics.staleHits++;
        return { status: 'stale', value: entry.value };
      }

      // Beyond both windows — the Redis TTL hasn't fired yet but logically expired
      this.metrics.misses++;
      return { status: 'miss' };
    } catch {
      this.metrics.misses++;
      return { status: 'miss' };
    }
  }

  /**
   * Simple get that returns the raw value string or null.
   * Live hits and stale hits both return the value; only a logical miss returns null.
   * Updates metrics.
   */
  async get(key: string): Promise<string | null> {
    const result = await this.getWithStatus(key);
    return result.status !== 'miss' ? result.value : null;
  }

  /**
   * Store a value with a jittered TTL.
   * The Redis key lives for `baseTtl * (1 + jitter + swrFactor)` seconds so
   * that the SWR window is also covered by the same key.
   */
  async set(key: string, value: string): Promise<void> {
    if (!this.client || !this.isReady) return;

    const jitter = Math.random() * this.jitterFactor;
    const liveTtlMs = this.baseTtlSeconds * 1000;
    const redisTtlSeconds = Math.ceil(
      (this.baseTtlSeconds * (1 + jitter + this.swrFactor)),
    );

    const entry: CacheEntry = {
      value,
      storedAt: Date.now(),
      liveTtlMs,
    };

    try {
      await this.client.setEx(key, redisTtlSeconds, JSON.stringify(entry));
    } catch {
      /* ignore — cache failures are non-fatal */
    }
  }

  /** Return a snapshot of the current in-process hit/miss metrics. */
  getMetrics(): Readonly<CacheMetrics> {
    return {
      hits: this.metrics.hits,
      staleHits: this.metrics.staleHits,
      misses: this.metrics.misses,
      get hitRate() {
        const total = this.hits + this.staleHits + this.misses;
        return total === 0 ? NaN : this.hits / total;
      },
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private parseCacheEntry(raw: string): CacheEntry | null {
    try {
      const parsed = JSON.parse(raw) as Partial<CacheEntry>;
      if (
        typeof parsed.value === 'string' &&
        typeof parsed.storedAt === 'number' &&
        typeof parsed.liveTtlMs === 'number'
      ) {
        return parsed as CacheEntry;
      }
      return null;
    } catch {
      return null;
    }
  }
}
