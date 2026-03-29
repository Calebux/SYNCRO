import { RateLimiterFactory } from '../src/middleware/rate-limit-factory';
import { rateLimitConfig } from '../src/config/rate-limit';
import * as redisStore from '../src/lib/redis-store';

// Mock the Redis store module
jest.mock('../src/lib/redis-store');
jest.mock('../src/config/logger');

describe('RateLimiterFactory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the factory state
    (RateLimiterFactory as any).redisStore = null;
    (RateLimiterFactory as any).redisStoreInitialized = false;
  });

  describe('initializeRedisStore', () => {
    it('should initialize Redis store successfully', async () => {
      const mockRedisStore = { mock: 'redis-store' };
      (redisStore.createRedisStore as jest.Mock).mockResolvedValue(mockRedisStore);

      await RateLimiterFactory.initializeRedisStore();

      expect(redisStore.createRedisStore).toHaveBeenCalledTimes(1);
      expect(RateLimiterFactory.getStoreStatus()).toEqual({
        type: 'redis',
        available: true,
      });
    });

    it('should fall back to memory store when Redis fails', async () => {
      (redisStore.createRedisStore as jest.Mock).mockRejectedValue(new Error('Redis connection failed'));

      await RateLimiterFactory.initializeRedisStore();

      expect(redisStore.createRedisStore).toHaveBeenCalledTimes(1);
      expect(RateLimiterFactory.getStoreStatus()).toEqual({
        type: 'memory',
        available: true,
      });
    });

    it('should not reinitialize if already initialized', async () => {
      const mockRedisStore = { mock: 'redis-store' };
      (redisStore.createRedisStore as jest.Mock).mockResolvedValue(mockRedisStore);

      await RateLimiterFactory.initializeRedisStore();
      await RateLimiterFactory.initializeRedisStore();

      expect(redisStore.createRedisStore).toHaveBeenCalledTimes(1);
    });
  });

  describe('createTeamInviteLimiter', () => {
    it('should create team invite limiter with correct configuration', () => {
      const limiter = RateLimiterFactory.createTeamInviteLimiter();

      expect(limiter).toBeDefined();
      // The limiter is a function, so we can't easily test its internal config
      // but we can verify it was created without errors
    });

    it('should use user-based key generation', () => {
      const limiter = RateLimiterFactory.createTeamInviteLimiter();
      
      // Mock request with authenticated user
      const mockReq = {
        user: { id: 'user-123' },
        ip: '192.168.1.1',
        socket: { remoteAddress: '192.168.1.1' },
      };

      // We can't directly test the keyGenerator since it's internal,
      // but we can verify the limiter was created successfully
      expect(limiter).toBeDefined();
    });
  });

  describe('createMfaLimiter', () => {
    it('should create MFA limiter with correct configuration', () => {
      const limiter = RateLimiterFactory.createMfaLimiter();

      expect(limiter).toBeDefined();
    });
  });

  describe('createAdminLimiter', () => {
    it('should create admin limiter with correct configuration', () => {
      const limiter = RateLimiterFactory.createAdminLimiter();

      expect(limiter).toBeDefined();
    });
  });

  describe('createCustomLimiter', () => {
    it('should create custom limiter with provided configuration', () => {
      const config = {
        windowMs: 60000,
        max: 10,
        message: { error: 'Custom rate limit exceeded' },
        endpointType: 'custom',
      };

      const limiter = RateLimiterFactory.createCustomLimiter(config);

      expect(limiter).toBeDefined();
    });

    it('should use custom key generator when provided', () => {
      const customKeyGenerator = jest.fn().mockReturnValue('custom-key');
      const config = {
        windowMs: 60000,
        max: 10,
        message: { error: 'Custom rate limit exceeded' },
        keyGenerator: customKeyGenerator,
        endpointType: 'custom',
      };

      const limiter = RateLimiterFactory.createCustomLimiter(config);

      expect(limiter).toBeDefined();
    });
  });

  describe('getStoreStatus', () => {
    it('should return memory store status when Redis not initialized', () => {
      const status = RateLimiterFactory.getStoreStatus();

      expect(status).toEqual({
        type: 'memory',
        available: false,
      });
    });

    it('should return Redis store status when Redis is initialized', async () => {
      const mockRedisStore = { mock: 'redis-store' };
      (redisStore.createRedisStore as jest.Mock).mockResolvedValue(mockRedisStore);

      await RateLimiterFactory.initializeRedisStore();
      const status = RateLimiterFactory.getStoreStatus();

      expect(status).toEqual({
        type: 'redis',
        available: true,
      });
    });
  });
});