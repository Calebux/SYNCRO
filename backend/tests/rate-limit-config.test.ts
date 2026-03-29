import { loadRateLimitConfig } from '../src/config/rate-limit';

// Mock logger to avoid console output during tests
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('Rate Limit Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('loadRateLimitConfig', () => {
    it('should load default configuration when no environment variables are set', () => {
      // Clear relevant environment variables
      delete process.env.RATE_LIMIT_REDIS_URL;
      delete process.env.RATE_LIMIT_TEAM_INVITE_MAX;
      delete process.env.RATE_LIMIT_MFA_MAX;
      delete process.env.RATE_LIMIT_ADMIN_MAX;

      const config = loadRateLimitConfig();

      expect(config.redis.enabled).toBe(false);
      expect(config.teamInvite.max).toBe(20);
      expect(config.teamInvite.windowMs).toBe(60 * 60 * 1000); // 1 hour
      expect(config.mfa.max).toBe(10);
      expect(config.mfa.windowMs).toBe(15 * 60 * 1000); // 15 minutes
      expect(config.admin.max).toBe(100);
      expect(config.admin.windowMs).toBe(60 * 60 * 1000); // 1 hour
    });

    it('should use environment variables when provided', () => {
      process.env.RATE_LIMIT_REDIS_URL = 'redis://localhost:6379';
      process.env.RATE_LIMIT_TEAM_INVITE_MAX = '50';
      process.env.RATE_LIMIT_TEAM_INVITE_WINDOW_HOURS = '2';
      process.env.RATE_LIMIT_MFA_MAX = '5';
      process.env.RATE_LIMIT_MFA_WINDOW_MINUTES = '30';
      process.env.RATE_LIMIT_ADMIN_MAX = '200';
      process.env.RATE_LIMIT_ADMIN_WINDOW_HOURS = '3';

      const config = loadRateLimitConfig();

      expect(config.redis.enabled).toBe(true);
      expect(config.redis.url).toBe('redis://localhost:6379');
      expect(config.teamInvite.max).toBe(50);
      expect(config.teamInvite.windowMs).toBe(2 * 60 * 60 * 1000); // 2 hours
      expect(config.mfa.max).toBe(5);
      expect(config.mfa.windowMs).toBe(30 * 60 * 1000); // 30 minutes
      expect(config.admin.max).toBe(200);
      expect(config.admin.windowMs).toBe(3 * 60 * 60 * 1000); // 3 hours
    });

    it('should use defaults for invalid environment variables', () => {
      process.env.RATE_LIMIT_TEAM_INVITE_MAX = 'invalid';
      process.env.RATE_LIMIT_MFA_MAX = '-5';
      process.env.RATE_LIMIT_ADMIN_MAX = '0';

      const config = loadRateLimitConfig();

      expect(config.teamInvite.max).toBe(20); // default
      expect(config.mfa.max).toBe(10); // default
      expect(config.admin.max).toBe(100); // default
    });

    it('should generate appropriate error messages', () => {
      process.env.RATE_LIMIT_TEAM_INVITE_MAX = '25';
      process.env.RATE_LIMIT_TEAM_INVITE_WINDOW_HOURS = '2';

      const config = loadRateLimitConfig();

      expect(config.teamInvite.message.error).toContain('25 invitations per 2 hours');
    });

    it('should handle singular vs plural in error messages', () => {
      process.env.RATE_LIMIT_TEAM_INVITE_WINDOW_HOURS = '1';
      process.env.RATE_LIMIT_MFA_WINDOW_MINUTES = '1';

      const config = loadRateLimitConfig();

      expect(config.teamInvite.message.error).toContain('1 hour');
      expect(config.mfa.message.error).toContain('1 minute');
    });

    it('should enable Redis when URL is provided', () => {
      process.env.RATE_LIMIT_REDIS_URL = 'redis://localhost:6379';

      const config = loadRateLimitConfig();

      expect(config.redis.enabled).toBe(true);
      expect(config.redis.url).toBe('redis://localhost:6379');
    });

    it('should disable Redis when explicitly set to false', () => {
      process.env.RATE_LIMIT_REDIS_URL = 'redis://localhost:6379';
      process.env.RATE_LIMIT_REDIS_ENABLED = 'false';

      const config = loadRateLimitConfig();

      expect(config.redis.enabled).toBe(false);
    });

    it('should set standard headers to true and legacy headers to false', () => {
      const config = loadRateLimitConfig();

      expect(config.teamInvite.standardHeaders).toBe(true);
      expect(config.teamInvite.legacyHeaders).toBe(false);
      expect(config.mfa.standardHeaders).toBe(true);
      expect(config.mfa.legacyHeaders).toBe(false);
      expect(config.admin.standardHeaders).toBe(true);
      expect(config.admin.legacyHeaders).toBe(false);
    });
  });
});