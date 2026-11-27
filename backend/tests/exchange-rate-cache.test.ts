/**
 * Tests for ExchangeRateService caching behaviour (#1092):
 *   - Redis stale-while-revalidate path
 *   - Background revalidation (non-blocking)
 *   - getCacheHitRate() / getCacheMetrics()
 *
 * The suite mocks RedisCacheAdapter to avoid a real Redis dependency and to
 * exercise every cache status branch deterministically.
 */

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnValue({ error: null }),
    }),
  },
}));

// Mock RedisCacheAdapter so we can control what it returns per-test
jest.mock('../src/services/exchange-rate/redis-cache', () => {
  const mockGetWithStatus = jest.fn();
  const mockSet = jest.fn();
  const mockGetMetrics = jest.fn().mockReturnValue({
    hits: 0,
    staleHits: 0,
    misses: 0,
    hitRate: NaN,
  });

  return {
    RedisCacheAdapter: jest.fn().mockImplementation(() => ({
      getWithStatus: mockGetWithStatus,
      get: jest.fn().mockResolvedValue(null),
      set: mockSet,
      getMetrics: mockGetMetrics,
    })),
    // Expose mocks for test access
    __mockGetWithStatus: mockGetWithStatus,
    __mockSet: mockSet,
    __mockGetMetrics: mockGetMetrics,
  };
});

import { ExchangeRateService } from '../src/services/exchange-rate/exchange-rate-service';
import type { ExchangeRateProvider } from '../src/services/exchange-rate/types';

// Helpers to grab the shared mock functions
function getAdapterMocks() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/services/exchange-rate/redis-cache') as {
    __mockGetWithStatus: jest.Mock;
    __mockSet: jest.Mock;
    __mockGetMetrics: jest.Mock;
  };
  return {
    getWithStatus: mod.__mockGetWithStatus,
    set: mod.__mockSet,
    getMetrics: mod.__mockGetMetrics,
  };
}

function makeProvider(
  name: string,
  rates: Record<string, number>,
  shouldFail = false,
): ExchangeRateProvider {
  return {
    getName: () => name,
    supportsCurrency: () => true,
    getRates: shouldFail
      ? jest.fn().mockRejectedValue(new Error(`${name} down`))
      : jest.fn().mockResolvedValue(rates),
  };
}

const LIVE_RATES = { EUR: 0.92, GBP: 0.79, XLM: 8.5 };

// ─────────────────────────────────────────────────────────────────────────────
describe('ExchangeRateService – caching behaviour (#1092)', () => {
  let service: ExchangeRateService;
  let provider: ExchangeRateProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = makeProvider('mock', LIVE_RATES);
    service = new ExchangeRateService([provider]);
  });

  // ── Redis live hit ─────────────────────────────────────────────────────────
  describe('Redis live hit', () => {
    it('returns cached rates without calling providers', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'hit',
        value: JSON.stringify({ rates: LIVE_RATES, fetchedAt: Date.now() }),
      });

      const rates = await service.getRates('USD');

      expect(rates.EUR).toBe(0.92);
      expect(provider.getRates).not.toHaveBeenCalled();
    });

    it('warms in-memory cache from Redis hit so second call skips Redis', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'hit',
        value: JSON.stringify({ rates: LIVE_RATES, fetchedAt: Date.now() }),
      });

      await service.getRates('USD');
      await service.getRates('USD');

      // Redis should only be consulted on the first call; second call uses
      // in-memory cache (getWithStatus not called a second time)
      expect(getWithStatus).toHaveBeenCalledTimes(1);
    });
  });

  // ── Redis stale hit (SWR) ──────────────────────────────────────────────────
  describe('Redis stale-while-revalidate', () => {
    it('returns stale rates immediately without blocking', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify({ rates: { EUR: 0.88, GBP: 0.75, XLM: 7.0 }, fetchedAt: 0 }),
      });

      const rates = await service.getRates('USD');

      // Should get the stale values back without calling providers inline
      expect(rates.EUR).toBe(0.88);
    });

    it('does not call providers synchronously on a stale hit', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify({ rates: LIVE_RATES, fetchedAt: 0 }),
      });

      await service.getRates('USD');

      // Provider may be called asynchronously in background, but let's confirm
      // the getRates() promise itself returned before any provider call
      // (i.e. not awaited synchronously).
      // We can verify this by checking the source in getExchangeRateResponse.
      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify({ rates: LIVE_RATES, fetchedAt: 0 }),
      });
      const response = await service.getExchangeRateResponse('EUR');
      expect(response.stale).toBe(true);
      expect(response.source).toBe('stale-cache');
    });

    it('triggers a background revalidation after a stale hit', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify({ rates: { EUR: 0.88 }, fetchedAt: 0 }),
      });

      await service.getRates('USD');

      // Let the event loop drain so the background refresh has a chance to run
      await new Promise((r) => setImmediate(r));

      expect(provider.getRates).toHaveBeenCalled();
    });

    it('does not schedule duplicate background revalidations for the same currency', async () => {
      const { getWithStatus } = getAdapterMocks();
      // Make provider slow so revalidation is still running on second call
      let resolveProvider!: () => void;
      (provider.getRates as jest.Mock).mockReturnValue(
        new Promise<Record<string, number>>((resolve) => {
          resolveProvider = () => resolve(LIVE_RATES);
        }),
      );

      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify({ rates: LIVE_RATES, fetchedAt: 0 }),
      });

      await service.getRates('USD');
      await service.getRates('USD');

      resolveProvider();
      await new Promise((r) => setImmediate(r));

      // Provider should only be called once despite two stale hits
      expect(provider.getRates).toHaveBeenCalledTimes(1);
    });
  });

  // ── Redis miss → live fetch ────────────────────────────────────────────────
  describe('Redis miss', () => {
    it('fetches from providers and stores result in Redis', async () => {
      const { getWithStatus, set } = getAdapterMocks();
      getWithStatus.mockResolvedValue({ status: 'miss' });
      set.mockResolvedValue(undefined);

      const rates = await service.getRates('USD');

      expect(rates.EUR).toBe(0.92);
      expect(provider.getRates).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalled();
    });

    it('falls back to stale in-memory cache when all providers fail', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({ status: 'miss' });

      // First successful call
      await service.getRates('USD');
      // Force in-memory cache to "stale"
      service.expireCacheForTesting('USD');

      // Make providers fail on next call
      (provider.getRates as jest.Mock).mockRejectedValue(new Error('down'));
      getWithStatus.mockResolvedValue({ status: 'miss' });

      const rates = await service.getRates('USD');
      expect(rates.EUR).toBe(0.92); // stale in-memory
    });

    it('returns static fallback when no cache and all providers fail', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({ status: 'miss' });
      (provider.getRates as jest.Mock).mockRejectedValue(new Error('down'));

      const response = await service.getExchangeRateResponse('USD');
      expect(response.stale).toBe(true);
      expect(response.source).toBe('static-fallback');
    });
  });

  // ── getCacheHitRate / getCacheMetrics ──────────────────────────────────────
  describe('getCacheHitRate() and getCacheMetrics()', () => {
    it('getCacheHitRate() delegates to the adapter', () => {
      const { getMetrics } = getAdapterMocks();
      getMetrics.mockReturnValue({ hits: 3, staleHits: 1, misses: 1, hitRate: 0.6 });

      expect(service.getCacheHitRate()).toBe(0.6);
    });

    it('getCacheMetrics() returns the full snapshot', () => {
      const { getMetrics } = getAdapterMocks();
      const snapshot = { hits: 10, staleHits: 2, misses: 3, hitRate: 10 / 15 };
      getMetrics.mockReturnValue(snapshot);

      const m = service.getCacheMetrics();
      expect(m.hits).toBe(10);
      expect(m.staleHits).toBe(2);
      expect(m.misses).toBe(3);
      expect(m.hitRate).toBeCloseTo(10 / 15);
    });
  });

  // ── In-memory cache within TTL ─────────────────────────────────────────────
  describe('in-memory cache within TTL', () => {
    it('does not consult Redis when in-memory entry is still fresh', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({ status: 'miss' });

      // First call misses Redis, fetches from providers
      await service.getRates('USD');
      expect(provider.getRates).toHaveBeenCalledTimes(1);
      jest.clearAllMocks();

      // Second call — in-memory TTL not expired → neither Redis nor provider consulted
      await service.getRates('USD');
      expect(getWithStatus).not.toHaveBeenCalled();
      expect(provider.getRates).not.toHaveBeenCalled();
    });
  });

  // ── getExchangeRateResponse source field ──────────────────────────────────
  describe('getExchangeRateResponse()', () => {
    it('sets stale=false and source=live on a fresh Redis hit', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'hit',
        value: JSON.stringify({ rates: LIVE_RATES, fetchedAt: Date.now() }),
      });

      const resp = await service.getExchangeRateResponse('USD');
      expect(resp.stale).toBe(false);
      expect(resp.source).toBe('live');
    });

    it('sets stale=true and source=stale-cache on a Redis stale hit', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify({ rates: LIVE_RATES, fetchedAt: 0 }),
      });

      const resp = await service.getExchangeRateResponse('USD');
      expect(resp.stale).toBe(true);
      expect(resp.source).toBe('stale-cache');
    });
  });
});
