import logger from '../../config/logger';
import { supabase, databaseRepository, databaseRepository } from '../../config/database';
import { STATIC_RATES_USD } from './static-rates';
import { RedisCacheAdapter } from './redis-cache';
import type { ExchangeRateProvider, CachedRates, ExchangeRateResponse } from './types';

/**
 * How long a freshly-fetched result is considered "live" before the service
 * will attempt to re-fetch from providers. Defaults to 15 minutes.
 * Override via EXCHANGE_RATE_TTL_MS environment variable.
 */
const DEFAULT_TTL_MS = 900_000; // 15 minutes

function getTtl(): number {
  const env = process.env.EXCHANGE_RATE_TTL_MS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TTL_MS;
}

/**
 * Result type returned by the internal fetch helper so the public methods
 * know which data source was used.
 */
type FetchResult =
  | { source: 'live'; rates: Record<string, number> }
  | { source: 'stale-cache'; rates: Record<string, number> }
  | { source: 'static-fallback'; rates: Record<string, number> };

const REDIS_KEY_PREFIX = 'exchange-rates:';

export class ExchangeRateService {
  private cache = new Map<string, CachedRates>();
  private readonly ttl: number;
  private providers: ExchangeRateProvider[];
  private redisCache: RedisCacheAdapter;

  /**
   * Set of currencies currently being revalidated in the background (SWR).
   * Prevents multiple concurrent background refreshes for the same currency.
   */
  private revalidating = new Set<string>();

  constructor(providers: ExchangeRateProvider[], ttlMs?: number) {
    this.providers = providers;
    this.ttl = ttlMs ?? getTtl();
    // TTL in seconds for Redis (same duration as in-memory TTL)
    this.redisCache = new RedisCacheAdapter(Math.floor(this.ttl / 1000));
  }

  /**
   * Returns exchange rates for the given base currency.
   * Fetch order:
   *   1. In-memory cache (fastest path, within TTL)
   *   2. Redis cache – live hit (shared between instances, within TTL)
   *   3. Redis cache – stale hit (SWR: serve stale, revalidate in background)
   *   4. Live providers (tried in order; partial results accepted)
   *   5. Stale in-memory cache (if all providers fail but a prior entry exists)
   *   6. Static hardcoded rates (last resort)
   */
  async getRates(baseCurrency: string): Promise<Record<string, number>> {
    const result = await this.getRatesWithSource(baseCurrency);
    return result.rates;
  }

  async getRate(from: string, to: string): Promise<number> {
    if (from === to) return 1;

    // Always fetch USD-based rates and cross-convert
    const rates = await this.getRates('USD');
    const fromRate = from === 'USD' ? 1 : rates[from];
    const toRate = to === 'USD' ? 1 : rates[to];

    if (!fromRate || !toRate) {
      throw new Error(`Cannot convert between ${from} and ${to}: missing rate`);
    }

    return toRate / fromRate;
  }

  async convert(amount: number, from: string, to: string): Promise<number> {
    const rate = await this.getRate(from, to);
    return amount * rate;
  }

  async getExchangeRateResponse(baseCurrency: string): Promise<ExchangeRateResponse> {
    const result = await this.getRatesWithSource(baseCurrency);
    const cached = this.cache.get(baseCurrency);

    // `cachedAt` reflects the last *successful live fetch*. When rates came from
    // the static fallback (no cache entry ever existed) there is no meaningful
    // timestamp, so we report null rather than `now` — reporting `now` would
    // falsely signal fresh data and defeat the whole staleness mechanism.
    const hasCacheEntry = cached !== undefined;
    const cachedAt = hasCacheEntry ? new Date(cached!.fetchedAt).toISOString() : null;
    const ageMs = hasCacheEntry ? Date.now() - cached!.fetchedAt : null;

    return {
      base: baseCurrency,
      rates: result.rates,
      cachedAt,
      ageMs,
      stale: result.source !== 'live',
      source: result.source,
    };
  }

  /**
   * Returns the current Redis cache hit-rate metric as a fraction in [0, 1].
   * Returns NaN when no requests have been recorded yet.
   */
  getCacheHitRate(): number {
    return this.redisCache.getMetrics().hitRate;
  }

  /**
   * Returns a full snapshot of cache metrics (hits, staleHits, misses, hitRate).
   */
  getCacheMetrics() {
    return this.redisCache.getMetrics();
  }

  /** Test helper: expire cache entry to simulate TTL expiry */
  expireCacheForTesting(baseCurrency: string): void {
    const cached = this.cache.get(baseCurrency);
    if (cached) {
      cached.fetchedAt = 0;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getRatesWithSource(baseCurrency: string): Promise<FetchResult> {
    // 1. In-memory cache (fastest path)
    const cached = this.cache.get(baseCurrency);
    const isFresh = cached !== undefined && Date.now() - cached.fetchedAt < this.ttl;

    if (isFresh) {
      return { source: 'live', rates: cached!.rates };
    }

    // 2 & 3. Redis cache (shared between instances) — with SWR support
    const redisResult = await this.redisCache.getWithStatus(REDIS_KEY_PREFIX + baseCurrency);

    if (redisResult.status === 'hit') {
      const rates = this.parseRedisRates(redisResult.value);
      if (rates) {
        // Warm the in-memory cache so subsequent calls skip Redis
        this.cache.set(baseCurrency, { rates, fetchedAt: Date.now() });
        return { source: 'live', rates };
      }
    }

    if (redisResult.status === 'stale') {
      const rates = this.parseRedisRates(redisResult.value);
      if (rates) {
        // Serve stale data immediately; kick off a background revalidation
        this.scheduleBackgroundRevalidation(baseCurrency);
        // Keep (or refresh) the in-memory stale copy so we don't re-check Redis
        if (!cached) {
          this.cache.set(baseCurrency, { rates, fetchedAt: 0 });
        }
        return { source: 'stale-cache', rates };
      }
    }

    // 4. Live providers
    try {
      const allRates = await this.fetchFromProviders(baseCurrency);
      const fetchedAt = Date.now();
      this.cache.set(baseCurrency, { rates: allRates, fetchedAt });

      // Store in Redis with jitter (non-blocking)
      this.redisCache
        .set(REDIS_KEY_PREFIX + baseCurrency, JSON.stringify({ rates: allRates, fetchedAt }))
        .catch(() => undefined);

      // Persist to historical table (non-blocking)
      this.storeHistoricalRate(baseCurrency, allRates, 'live').catch(() => undefined);

      return { source: 'live', rates: allRates };
    } catch (error) {
      logger.error('All exchange rate providers failed', { baseCurrency, error });

      // Fallback 1: stale in-memory cache
      if (cached) {
        logger.warn('Returning stale cached rates', {
          baseCurrency,
          cachedAt: new Date(cached.fetchedAt).toISOString(),
        });
        return { source: 'stale-cache', rates: cached.rates };
      }

      // Fallback 2: static rates
      logger.warn('Returning static fallback rates — no live data or cache available', {
        baseCurrency,
      });
      return { source: 'static-fallback', rates: this.buildStaticRates(baseCurrency) };
    }
  }

  /**
   * Parse raw Redis JSON into a rates object.
   * Handles both the new `{ rates, fetchedAt }` envelope and plain rate maps.
   */
  private parseRedisRates(raw: string): Record<string, number> | null {
    try {
      const parsed = JSON.parse(raw) as
        | { rates: Record<string, number>; fetchedAt: number }
        | Record<string, number>;
      if (parsed && typeof parsed === 'object') {
        if ('rates' in parsed && typeof parsed.rates === 'object') {
          return parsed.rates;
        }
        // Plain rate map (legacy format)
        return parsed as Record<string, number>;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Trigger a background re-fetch for `baseCurrency` without blocking the
   * current request.  Guards against duplicate concurrent revalidations.
   */
  private scheduleBackgroundRevalidation(baseCurrency: string): void {
    if (this.revalidating.has(baseCurrency)) return;

    this.revalidating.add(baseCurrency);
    this.fetchFromProviders(baseCurrency)
      .then((allRates) => {
        const fetchedAt = Date.now();
        this.cache.set(baseCurrency, { rates: allRates, fetchedAt });
        return this.redisCache.set(
          REDIS_KEY_PREFIX + baseCurrency,
          JSON.stringify({ rates: allRates, fetchedAt }),
        );
      })
      .then(() => {
        logger.debug('SWR background revalidation succeeded', { baseCurrency });
      })
      .catch((err) => {
        logger.warn('SWR background revalidation failed', { baseCurrency, err });
      })
      .finally(() => {
        this.revalidating.delete(baseCurrency);
      });
  }

  /**
   * Persist rate snapshot to `exchange_rate_history` for analytics.
   * Failures are swallowed — this is a best-effort write.
   */
  private async storeHistoricalRate(
    baseCurrency: string,
    rates: Record<string, number>,
    source: string,
  ): Promise<void> {
    try {
      const { error } = await databaseRepository.from('exchange_rate_history').insert({
        base_currency: baseCurrency,
        rates,
        source,
        fetched_at: new Date().toISOString(),
      });
      if (error) {
        logger.warn('Failed to store historical exchange rate', {
          baseCurrency,
          error: error.message,
        });
      }
    } catch (err) {
      logger.warn('Failed to store historical exchange rate', { baseCurrency, err });
    }
  }

  /**
   * Tries each provider in order and merges results.
   * A single provider failure is logged as a warning and does not abort the
   * overall fetch — partial results from other providers are still used.
   * Only throws (AggregateError) when zero rates were collected from any provider.
   */
  private async fetchFromProviders(baseCurrency: string): Promise<Record<string, number>> {
    const allRates: Record<string, number> = {};
    const errors: Error[] = [];

    for (const provider of this.providers) {
      try {
        const rates = await provider.getRates(baseCurrency);
        Object.assign(allRates, rates);
        logger.debug(`Provider ${provider.getName()} succeeded`, {
          baseCurrency,
          rateCount: Object.keys(rates).length,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Provider ${provider.getName()} failed`, {
          baseCurrency,
          error: err.message,
        });
        errors.push(err);
      }
    }

    if (Object.keys(allRates).length === 0) {
      throw new AggregateError(errors, 'All providers failed');
    }

    return allRates;
  }

  private buildStaticRates(baseCurrency: string): Record<string, number> {
    if (baseCurrency === 'USD') {
      return { ...STATIC_RATES_USD };
    }

    const usdToBase = STATIC_RATES_USD[baseCurrency];
    if (usdToBase) {
      const rates: Record<string, number> = {};
      for (const [currency, usdRate] of Object.entries(STATIC_RATES_USD)) {
        rates[currency] = usdRate / usdToBase;
      }
      return rates;
    }

    // Unknown base currency — return USD-based static rates as best effort
    return { ...STATIC_RATES_USD };
  }
}
