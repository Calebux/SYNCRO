/**
 * Tests for MerchantService Redis caching behaviour (#1092):
 *   - cache-first reads (getMerchant, listMerchants)
 *   - stale-while-revalidate
 *   - write-back on updateMerchant
 *   - getCacheHitRate() / getCacheMetrics()
 */

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

// Controlled Supabase mock
const mockSingle = jest.fn();
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockEq = jest.fn();
const mockOrder = jest.fn();
const mockLimit = jest.fn();
const mockRange = jest.fn();

// Supabase query builder chain
function makeQueryChain() {
  const chain: Record<string, jest.Mock> = {};
  chain['select'] = mockSelect.mockReturnValue(chain);
  chain['insert'] = mockInsert.mockReturnValue(chain);
  chain['update'] = mockUpdate.mockReturnValue(chain);
  chain['delete'] = mockDelete.mockReturnValue(chain);
  chain['eq'] = mockEq.mockReturnValue(chain);
  chain['order'] = mockOrder.mockReturnValue(chain);
  chain['limit'] = mockLimit.mockReturnValue(chain);
  chain['range'] = mockRange.mockReturnValue(chain);
  chain['single'] = mockSingle;
  return chain;
}

const queryChain = makeQueryChain();

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn().mockReturnValue(queryChain),
  },
}));

// Mock RedisCacheAdapter
jest.mock('../src/services/exchange-rate/redis-cache', () => {
  const mockGetWithStatus = jest.fn();
  const mockSet = jest.fn().mockResolvedValue(undefined);
  const mockGetMetrics = jest.fn().mockReturnValue({
    hits: 0, staleHits: 0, misses: 0, hitRate: NaN,
  });

  return {
    RedisCacheAdapter: jest.fn().mockImplementation(() => ({
      getWithStatus: mockGetWithStatus,
      set: mockSet,
      getMetrics: mockGetMetrics,
    })),
    __mockGetWithStatus: mockGetWithStatus,
    __mockSet: mockSet,
    __mockGetMetrics: mockGetMetrics,
  };
});

import { MerchantService } from '../src/services/merchant-service';

function getAdapterMocks() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/services/exchange-rate/redis-cache') as {
    __mockGetWithStatus: jest.Mock;
    __mockSet: jest.Mock;
    __mockGetMetrics: jest.Mock;
  };
  return { getWithStatus: mod.__mockGetWithStatus, set: mod.__mockSet, getMetrics: mod.__mockGetMetrics };
}

const MERCHANT = {
  merchant_id: 'merchant-1',
  name: 'Netflix',
  logo_url: null,
  category: 'streaming',
  cancellation_url: 'https://netflix.com/cancel',
  gift_card_supported: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const MERCHANT_2 = { ...MERCHANT, merchant_id: 'merchant-2', name: 'Spotify' };

// ─────────────────────────────────────────────────────────────────────────────
describe('MerchantService – caching behaviour (#1092)', () => {
  let service: MerchantService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantService();
    // Default: set() succeeds
    getAdapterMocks().set.mockResolvedValue(undefined);
  });

  // ── getMerchant ─────────────────────────────────────────────────────────────
  describe('getMerchant()', () => {
    it('returns cached merchant on live cache hit without hitting DB', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'hit',
        value: JSON.stringify(MERCHANT),
      });

      const result = await service.getMerchant('merchant-1');

      expect(result).toEqual(MERCHANT);
      // DB should not have been consulted
      const { supabase } = require('../src/config/database') as { supabase: { from: jest.Mock } };
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('returns stale merchant on stale cache hit without blocking', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify(MERCHANT),
      });
      // Simulate a slow DB so we can confirm getMerchant() returns before DB completes
      let dbResolved = false;
      mockSingle.mockImplementation(
        () =>
          new Promise<{ data: typeof MERCHANT; error: null }>((resolve) =>
            setTimeout(() => {
              dbResolved = true;
              resolve({ data: MERCHANT, error: null });
            }, 100),
          ),
      );

      const result = await service.getMerchant('merchant-1');

      // Should return the stale cached value immediately (DB not yet done)
      expect(result).toEqual(MERCHANT);
      expect(dbResolved).toBe(false);
    });

    it('fetches from DB on cache miss and populates cache', async () => {
      const { getWithStatus, set } = getAdapterMocks();
      getWithStatus.mockResolvedValue({ status: 'miss' });
      mockSingle.mockResolvedValue({ data: MERCHANT, error: null });

      const result = await service.getMerchant('merchant-1');

      expect(result).toEqual(MERCHANT);
      expect(set).toHaveBeenCalledWith(
        'merchant:merchant-1',
        JSON.stringify(MERCHANT),
      );
    });

    it('throws when DB returns an error', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({ status: 'miss' });
      mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

      await expect(service.getMerchant('merchant-1')).rejects.toThrow('not found');
    });

    it('throws when DB returns null data', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({ status: 'miss' });
      mockSingle.mockResolvedValue({ data: null, error: null });

      await expect(service.getMerchant('merchant-1')).rejects.toThrow('Merchant not found');
    });

    it('triggers background revalidation on stale hit', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify(MERCHANT),
      });
      mockSingle.mockResolvedValue({ data: MERCHANT, error: null });

      await service.getMerchant('merchant-1');

      // Let the event loop drain
      await new Promise((r) => setImmediate(r));

      const { supabase } = require('../src/config/database') as { supabase: { from: jest.Mock } };
      expect(supabase.from).toHaveBeenCalled();
    });

    it('does not schedule duplicate background revalidations', async () => {
      const { getWithStatus } = getAdapterMocks();
      let resolveDb!: () => void;
      mockSingle.mockReturnValue(
        new Promise<{ data: typeof MERCHANT; error: null }>((resolve) => {
          resolveDb = () => resolve({ data: MERCHANT, error: null });
        }),
      );

      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify(MERCHANT),
      });

      await service.getMerchant('merchant-1');
      await service.getMerchant('merchant-1');

      resolveDb();
      await new Promise((r) => setImmediate(r));

      const { supabase } = require('../src/config/database') as { supabase: { from: jest.Mock } };
      // Only one background DB query should have been made
      expect(supabase.from).toHaveBeenCalledTimes(1);
    });
  });

  // ── listMerchants ────────────────────────────────────────────────────────────
  describe('listMerchants()', () => {
    const LIST_RESULT = { merchants: [MERCHANT, MERCHANT_2], total: 2 };

    beforeEach(() => {
      // listMerchants uses a different query chain (no .single())
      mockOrder.mockReturnValue(queryChain);
      mockLimit.mockReturnValue(queryChain);
      mockRange.mockReturnValue(queryChain);
      // The terminal promise for list queries
      (queryChain as unknown as Promise<unknown> & { then?: () => void }).then = undefined;
      // Make the query chain awaitable for list queries
      // We simulate the select call returning { data, error, count }
    });

    it('returns cached list on live hit', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'hit',
        value: JSON.stringify(LIST_RESULT),
      });

      const result = await service.listMerchants({ limit: 50, offset: 0 });

      expect(result).toEqual(LIST_RESULT);
      const { supabase } = require('../src/config/database') as { supabase: { from: jest.Mock } };
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('returns cached list on stale hit', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'stale',
        value: JSON.stringify(LIST_RESULT),
      });

      const result = await service.listMerchants({ limit: 50, offset: 0 });

      expect(result).toEqual(LIST_RESULT);
    });

    it('caches the fetched list on a miss', async () => {
      const { getWithStatus, set } = getAdapterMocks();
      getWithStatus.mockResolvedValue({ status: 'miss' });

      // Simulate the select().order().limit() chain returning data
      const queryResult = { data: [MERCHANT], error: null, count: 1 };
      // override the query chain to be thenable at the end
      Object.assign(queryChain, queryResult);
      mockLimit.mockResolvedValue(queryResult);

      await service.listMerchants({ limit: 50, offset: 0 });

      // cache should have been populated
      expect(set).toHaveBeenCalled();
    });
  });

  // ── updateMerchant writes back to cache ───────────────────────────────────
  describe('updateMerchant()', () => {
    it('writes the updated merchant back to Redis cache', async () => {
      const { set } = getAdapterMocks();
      mockSingle.mockResolvedValue({ data: MERCHANT, error: null });

      await service.updateMerchant('merchant-1', { name: 'Netflix Updated' });

      expect(set).toHaveBeenCalledWith(
        'merchant:merchant-1',
        JSON.stringify(MERCHANT),
      );
    });

    it('throws when Supabase returns an error', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } });

      await expect(
        service.updateMerchant('merchant-1', { name: 'X' }),
      ).rejects.toThrow('DB error');
    });
  });

  // ── getCacheHitRate / getCacheMetrics ─────────────────────────────────────
  describe('getCacheHitRate() and getCacheMetrics()', () => {
    it('getCacheHitRate() delegates to the adapter', () => {
      const { getMetrics } = getAdapterMocks();
      getMetrics.mockReturnValue({ hits: 5, staleHits: 1, misses: 4, hitRate: 0.5 });

      expect(service.getCacheHitRate()).toBe(0.5);
    });

    it('getCacheMetrics() returns the full snapshot', () => {
      const { getMetrics } = getAdapterMocks();
      const snapshot = { hits: 10, staleHits: 2, misses: 3, hitRate: 10 / 15 };
      getMetrics.mockReturnValue(snapshot);

      const m = service.getCacheMetrics();
      expect(m.hits).toBe(10);
      expect(m.staleHits).toBe(2);
      expect(m.misses).toBe(3);
    });
  });

  // ── cache key scoping ──────────────────────────────────────────────────────
  describe('cache key scoping', () => {
    it('uses distinct keys for different merchant IDs', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus
        .mockResolvedValueOnce({ status: 'hit', value: JSON.stringify(MERCHANT) })
        .mockResolvedValueOnce({ status: 'hit', value: JSON.stringify(MERCHANT_2) });

      await service.getMerchant('merchant-1');
      await service.getMerchant('merchant-2');

      const keys = getWithStatus.mock.calls.map((c) => c[0]);
      expect(keys[0]).toBe('merchant:merchant-1');
      expect(keys[1]).toBe('merchant:merchant-2');
    });

    it('uses distinct keys for different list query parameters', async () => {
      const { getWithStatus } = getAdapterMocks();
      getWithStatus.mockResolvedValue({
        status: 'hit',
        value: JSON.stringify({ merchants: [], total: 0 }),
      });

      await service.listMerchants({ limit: 10, offset: 0 });
      await service.listMerchants({ limit: 10, offset: 10 });
      await service.listMerchants({ limit: 10, offset: 0, category: 'streaming' });

      const keys = getWithStatus.mock.calls.map((c) => c[0]);
      expect(new Set(keys).size).toBe(3); // all distinct
    });
  });
});
