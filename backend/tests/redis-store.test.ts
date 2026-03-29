import { RateLimitRedisStore, createRedisStore } from '../src/lib/redis-store';
import { createClient } from 'redis';

// Mock Redis client and rate-limit-redis
jest.mock('redis');
jest.mock('rate-limit-redis');
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../src/config/rate-limit', () => ({
  rateLimitConfig: {
    redis: {
      enabled: true,
      url: 'redis://localhost:6379',
    },
  },
}));

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('RateLimitRedisStore', () => {
  let mockRedisClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRedisClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      sendCommand: jest.fn(),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
    };

    mockCreateClient.mockReturnValue(mockRedisClient);
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = RateLimitRedisStore.getInstance();
      const instance2 = RateLimitRedisStore.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should initialize Redis connection successfully', async () => {
      const store = RateLimitRedisStore.getInstance();

      await store.initialize();

      expect(mockCreateClient).toHaveBeenCalledWith({
        url: 'redis://localhost:6379',
        socket: {
          reconnectStrategy: expect.any(Function),
        },
      });
      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
    });

    it('should handle Redis connection failure', async () => {
      const store = RateLimitRedisStore.getInstance();
      const connectionError = new Error('Connection failed');
      mockRedisClient.connect.mockRejectedValue(connectionError);

      await expect(store.initialize()).rejects.toThrow('Connection failed');
      expect(store.isAvailable()).toBe(false);
    });

    it('should skip initialization when Redis is disabled', async () => {
      // Mock disabled Redis config
      jest.doMock('../src/config/rate-limit', () => ({
        rateLimitConfig: {
          redis: {
            enabled: false,
            url: null,
          },
        },
      }));

      const { RateLimitRedisStore: DisabledStore } = await import('../src/lib/redis-store');
      const store = DisabledStore.getInstance();

      await store.initialize();

      expect(mockCreateClient).not.toHaveBeenCalled();
    });
  });

  describe('getStore', () => {
    it('should return store when connected', async () => {
      const store = RateLimitRedisStore.getInstance();
      await store.initialize();

      // Simulate connection event
      const connectHandler = mockRedisClient.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();

      const redisStore = store.getStore();
      expect(redisStore).toBeDefined();
    });

    it('should return null when not connected', () => {
      const store = RateLimitRedisStore.getInstance();
      const redisStore = store.getStore();

      expect(redisStore).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('should return true when connected and store exists', async () => {
      const store = RateLimitRedisStore.getInstance();
      await store.initialize();

      // Simulate connection event
      const connectHandler = mockRedisClient.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();

      expect(store.isAvailable()).toBe(true);
    });

    it('should return false when not connected', () => {
      const store = RateLimitRedisStore.getInstance();

      expect(store.isAvailable()).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status with connection info', async () => {
      const store = RateLimitRedisStore.getInstance();
      await store.initialize();

      const status = store.getHealthStatus();

      expect(status).toEqual({
        connected: false,
        reconnectAttempts: 0,
        error: 'Redis connection unavailable',
      });
    });

    it('should return connected status when Redis is connected', async () => {
      const store = RateLimitRedisStore.getInstance();
      await store.initialize();

      // Simulate connection event
      const connectHandler = mockRedisClient.on.mock.calls.find(call => call[0] === 'connect')[1];
      connectHandler();

      const status = store.getHealthStatus();

      expect(status).toEqual({
        connected: true,
        reconnectAttempts: 0,
        error: undefined,
      });
    });
  });

  describe('reconnection strategy', () => {
    it('should implement exponential backoff with max attempts', async () => {
      const store = RateLimitRedisStore.getInstance();
      await store.initialize();

      const reconnectStrategy = mockCreateClient.mock.calls[0][0].socket.reconnectStrategy;

      // Test within max attempts
      expect(reconnectStrategy(0)).toBe(5000); // 5 seconds
      expect(reconnectStrategy(1)).toBe(10000); // 10 seconds
      expect(reconnectStrategy(2)).toBe(20000); // 20 seconds

      // Test max attempts exceeded
      expect(reconnectStrategy(5)).toBe(false);
    });

    it('should cap delay at 30 seconds', async () => {
      const store = RateLimitRedisStore.getInstance();
      await store.initialize();

      const reconnectStrategy = mockCreateClient.mock.calls[0][0].socket.reconnectStrategy;

      // Test delay capping
      expect(reconnectStrategy(4)).toBe(30000); // Capped at 30 seconds
    });
  });
});

describe('createRedisStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create Redis store when enabled', async () => {
    const mockStore = { mock: 'redis-store' };
    const mockStoreInstance = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getStore: jest.fn().mockReturnValue(mockStore),
    };

    jest.spyOn(RateLimitRedisStore, 'getInstance').mockReturnValue(mockStoreInstance as any);

    const result = await createRedisStore();

    expect(mockStoreInstance.initialize).toHaveBeenCalled();
    expect(result).toBe(mockStore);
  });

  it('should return undefined when Redis is disabled', async () => {
    // Mock disabled Redis config
    jest.doMock('../src/config/rate-limit', () => ({
      rateLimitConfig: {
        redis: {
          enabled: false,
        },
      },
    }));

    const { createRedisStore: disabledCreateRedisStore } = await import('../src/lib/redis-store');
    const result = await disabledCreateRedisStore();

    expect(result).toBeUndefined();
  });

  it('should return undefined when initialization fails', async () => {
    const mockStoreInstance = {
      initialize: jest.fn().mockRejectedValue(new Error('Init failed')),
      getStore: jest.fn().mockReturnValue(null),
    };

    jest.spyOn(RateLimitRedisStore, 'getInstance').mockReturnValue(mockStoreInstance as any);

    const result = await createRedisStore();

    expect(result).toBeUndefined();
  });
});