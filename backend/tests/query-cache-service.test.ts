jest.mock('../src/lib/redis-client', () => ({
  sharedRedisClient: {
    getClient: jest.fn(),
  },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

import { QueryCacheService } from '../src/services/query-cache-service';
import { sharedRedisClient } from '../src/lib/redis-client';

describe('QueryCacheService', () => {
  let service: QueryCacheService;
  let mockClient: {
    get: jest.Mock;
    set: jest.Mock;
    incr: jest.Mock;
    scan: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      get: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
      scan: jest.fn().mockResolvedValue({ cursor: '0', keys: [] }),
      del: jest.fn(),
    };
    (sharedRedisClient.getClient as jest.Mock).mockResolvedValue(mockClient);
    service = new QueryCacheService();
  });

  it('returns cached value on hit', async () => {
    mockClient.get.mockResolvedValue(JSON.stringify({ total: 5 }));

    const result = await service.get<{ total: number }>('user-1', 'subscription_list', { page: 1 });

    expect(result).toEqual({ total: 5 });
    expect(mockClient.incr).toHaveBeenCalledWith('query_cache:metrics:hits');
  });

  it('returns null on cache miss', async () => {
    mockClient.get.mockResolvedValue(null);

    const result = await service.get('user-1', 'subscription_list', { page: 1 });

    expect(result).toBeNull();
    expect(mockClient.incr).toHaveBeenCalledWith('query_cache:metrics:misses');
  });

  it('stores value with TTL', async () => {
    await service.set('user-1', 'analytics_summary', { type: 'summary' }, { spend: 100 }, 300000);

    expect(mockClient.set).toHaveBeenCalledWith(
      expect.stringContaining('query_cache:analytics_summary:user-1:'),
      JSON.stringify({ spend: 100 }),
      { EX: 300 },
    );
  });

  it('scopes cache keys per user for RLS safety', async () => {
    mockClient.get.mockResolvedValue(null);

    await service.get('user-a', 'subscription_list', {});
    await service.get('user-b', 'subscription_list', {});

    const keys = mockClient.get.mock.calls.map((c) => c[0]);
    expect(keys[0]).toContain(':user-a:');
    expect(keys[1]).toContain(':user-b:');
    expect(keys[0]).not.toEqual(keys[1]);
  });
});
