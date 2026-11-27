/**
 * Tests for the enhanced RedisCacheAdapter (#1092):
 *   - jittered TTL
 *   - stale-while-revalidate
 *   - hit/miss/stale metrics and hit-rate
 */

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

// We test the adapter without a real Redis connection.
// The adapter falls back silently when no REDIS_URL is set.
delete process.env.REDIS_URL;

import { RedisCacheAdapter } from '../src/services/exchange-rate/redis-cache';

// ── Helper: build a raw CacheEntry JSON as the adapter would store it ────────
function makeCacheEntry(
  value: string,
  storedAt: number,
  liveTtlMs: number,
): string {
  return JSON.stringify({ value, storedAt, liveTtlMs });
}

// ── Helper: inject a fake Redis client onto the adapter ───────────────────────
function injectFakeRedis(
  adapter: RedisCacheAdapter,
  store: Map<string, string>,
): void {
  const fakeClient = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    setEx: jest.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
    }),
  };
  // @ts-expect-error – accessing private fields for testing
  adapter['client'] = fakeClient;
  // @ts-expect-error
  adapter['isReady'] = true;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('RedisCacheAdapter', () => {
  const BASE_TTL_SECONDS = 60; // 1 minute
  const BASE_TTL_MS = BASE_TTL_SECONDS * 1000;

  describe('when Redis is unavailable (no REDIS_URL)', () => {
    it('get() returns null on every call', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      expect(await adapter.get('key')).toBeNull();
    });

    it('getWithStatus() returns miss', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      expect(await adapter.getWithStatus('key')).toEqual({ status: 'miss' });
    });

    it('set() does not throw', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      await expect(adapter.set('key', 'value')).resolves.toBeUndefined();
    });

    it('counts misses in metrics', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      await adapter.get('k1');
      await adapter.get('k2');
      const m = adapter.getMetrics();
      expect(m.misses).toBe(2);
      expect(m.hits).toBe(0);
      // hitRate = 0 / 2 = 0, not NaN, because misses are counted in the denominator
      expect(m.hitRate).toBe(0);
    });
  });

  describe('live hit (within TTL)', () => {
    it('getWithStatus() returns hit and correct value', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      const raw = makeCacheEntry('hello', Date.now() - 1000, BASE_TTL_MS);
      store.set('mykey', raw);

      const result = await adapter.getWithStatus('mykey');
      expect(result).toEqual({ status: 'hit', value: 'hello' });
    });

    it('increments hits counter', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      const raw = makeCacheEntry('v', Date.now() - 100, BASE_TTL_MS);
      store.set('k', raw);

      await adapter.getWithStatus('k');
      await adapter.getWithStatus('k');

      const m = adapter.getMetrics();
      expect(m.hits).toBe(2);
      expect(m.staleHits).toBe(0);
      expect(m.misses).toBe(0);
    });

    it('hit-rate is 1 when all requests are hits', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      const raw = makeCacheEntry('v', Date.now() - 100, BASE_TTL_MS);
      store.set('k', raw);

      await adapter.get('k');
      await adapter.get('k');

      expect(adapter.getMetrics().hitRate).toBe(1);
    });
  });

  describe('stale hit (within SWR window)', () => {
    it('returns stale status when entry is past live TTL but within SWR window', async () => {
      const swrFactor = 0.5;
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS, 0, swrFactor);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      // Entry is 1.2× live TTL old (past live, within SWR = 1.5× live TTL)
      const storedAt = Date.now() - BASE_TTL_MS * 1.2;
      const raw = makeCacheEntry('stale-value', storedAt, BASE_TTL_MS);
      store.set('k', raw);

      const result = await adapter.getWithStatus('k');
      expect(result).toEqual({ status: 'stale', value: 'stale-value' });
    });

    it('increments staleHits counter', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS, 0, 0.5);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      const storedAt = Date.now() - BASE_TTL_MS * 1.2;
      store.set('k', makeCacheEntry('stale', storedAt, BASE_TTL_MS));

      await adapter.getWithStatus('k');
      const m = adapter.getMetrics();
      expect(m.staleHits).toBe(1);
      expect(m.hits).toBe(0);
    });

    it('stale hit does not count as a hit in hitRate numerator', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS, 0, 0.5);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      const storedAt = Date.now() - BASE_TTL_MS * 1.2;
      store.set('k', makeCacheEntry('stale', storedAt, BASE_TTL_MS));

      // 1 stale hit, 0 live hits, 0 misses
      await adapter.getWithStatus('k');
      const m = adapter.getMetrics();
      expect(m.hitRate).toBe(0); // 0 live hits out of 1 total
    });
  });

  describe('miss (beyond both TTL and SWR window)', () => {
    it('returns miss when entry is beyond SWR window', async () => {
      const swrFactor = 0.5; // SWR window = 0.5 × live TTL
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS, 0, swrFactor);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      // 2× live TTL old — beyond live + SWR (1.5× live TTL)
      const storedAt = Date.now() - BASE_TTL_MS * 2;
      store.set('k', makeCacheEntry('expired', storedAt, BASE_TTL_MS));

      const result = await adapter.getWithStatus('k');
      expect(result).toEqual({ status: 'miss' });
    });

    it('returns miss when key does not exist', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      expect(await adapter.getWithStatus('nonexistent')).toEqual({ status: 'miss' });
    });

    it('increments misses counter', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS, 0, 0.5);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      const storedAt = Date.now() - BASE_TTL_MS * 2;
      store.set('k', makeCacheEntry('expired', storedAt, BASE_TTL_MS));

      await adapter.getWithStatus('k');
      await adapter.getWithStatus('nonexistent');

      const m = adapter.getMetrics();
      expect(m.misses).toBe(2);
    });
  });

  describe('set()', () => {
    it('stores a CacheEntry envelope in Redis', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS, 0, 0.5);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      await adapter.set('k', 'my-value');

      const raw = store.get('k');
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!);
      expect(parsed.value).toBe('my-value');
      expect(typeof parsed.storedAt).toBe('number');
      expect(parsed.liveTtlMs).toBe(BASE_TTL_MS);
    });

    it('stores with a Redis TTL that covers live + SWR window', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS, 0, 0.5);
      const store = new Map<string, string>();
      // @ts-expect-error
      const fakeClient = { get: jest.fn(), setEx: jest.fn() };
      // @ts-expect-error
      adapter['client'] = fakeClient;
      // @ts-expect-error
      adapter['isReady'] = true;

      await adapter.set('k', 'v');

      const [, redisTtl] = fakeClient.setEx.mock.calls[0];
      // With jitter=0 and swrFactor=0.5, TTL should be base * 1.5 seconds
      expect(redisTtl).toBe(Math.ceil(BASE_TTL_SECONDS * 1.5));
    });

    it('jitter produces TTL within expected range', async () => {
      const jitterFactor = 0.2;
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS, jitterFactor, 0);
      const store = new Map<string, string>();
      // @ts-expect-error
      const fakeClient = { get: jest.fn(), setEx: jest.fn() };
      // @ts-expect-error
      adapter['client'] = fakeClient;
      // @ts-expect-error
      adapter['isReady'] = true;

      // Sample many writes and check all TTLs fall in [base, base * (1 + jitter)]
      const ttls: number[] = [];
      for (let i = 0; i < 50; i++) {
        await adapter.set(`k${i}`, 'v');
        ttls.push(fakeClient.setEx.mock.calls[i][1]);
      }

      for (const ttl of ttls) {
        expect(ttl).toBeGreaterThanOrEqual(BASE_TTL_SECONDS);
        expect(ttl).toBeLessThanOrEqual(Math.ceil(BASE_TTL_SECONDS * (1 + jitterFactor)));
      }
    });
  });

  describe('legacy value (no CacheEntry envelope)', () => {
    it('treats a plain string stored without envelope as a live hit', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      // Simulate a value written by the old adapter (not a CacheEntry JSON)
      store.set('k', '"raw-value"');

      const result = await adapter.getWithStatus('k');
      // parseCacheEntry returns null for this shape, so it falls through to the
      // legacy branch and returns a live hit
      expect(result.status).toBe('hit');
    });
  });

  describe('metrics derived values', () => {
    it('hitRate is NaN when no requests recorded', () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS);
      expect(isNaN(adapter.getMetrics().hitRate)).toBe(true);
    });

    it('hitRate is computed as hits / (hits + staleHits + misses)', async () => {
      const adapter = new RedisCacheAdapter(BASE_TTL_SECONDS, 0, 0.5);
      const store = new Map<string, string>();
      injectFakeRedis(adapter, store);

      // 2 live hits
      store.set('live', makeCacheEntry('v', Date.now() - 100, BASE_TTL_MS));
      await adapter.get('live');
      await adapter.get('live');

      // 1 stale hit
      const staleStoredAt = Date.now() - BASE_TTL_MS * 1.2;
      store.set('stale', makeCacheEntry('s', staleStoredAt, BASE_TTL_MS));
      await adapter.get('stale');

      // 1 miss
      await adapter.get('nonexistent');

      const m = adapter.getMetrics();
      expect(m.hits).toBe(2);
      expect(m.staleHits).toBe(1);
      expect(m.misses).toBe(1);
      // hitRate = 2 / (2 + 1 + 1) = 0.5
      expect(m.hitRate).toBeCloseTo(0.5);
    });
  });
});
