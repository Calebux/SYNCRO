import { getTTLConfig, resetTTLConfig, TimeUnit } from '../../config/ttl-config';

describe('TTL Configuration', () => {
  beforeEach(() => {
    resetTTLConfig();
    // Clear env variables
    delete process.env.TTL_BUMP_THRESHOLD_DAYS;
    delete process.env.TTL_DEFAULT_EXTENSION_DAYS;
  });

  describe('loadTTLConfig', () => {
    it('should load default TTL configuration', () => {
      const config = getTTLConfig();
      expect(config).toBeDefined();
      expect(config.bumpThresholdSeconds).toBeGreaterThan(0);
      expect(config.defaultTtlExtensionSeconds).toBeGreaterThan(0);
    });

    it('should convert days to milliseconds correctly', () => {
      const config = getTTLConfig();
      const bumpThresholdMs = config.bumpThresholdMs;
      const bumpThresholdSeconds = config.bumpThresholdSeconds;
      expect(bumpThresholdMs).toBe(bumpThresholdSeconds * 1000);
    });

    it('should convert days to seconds correctly', () => {
      const config = getTTLConfig();
      // 7 days = 7 * 24 * 60 * 60 seconds
      const expectedSeconds = 7 * 24 * 60 * 60;
      expect(config.bumpThresholdSeconds).toBe(expectedSeconds);
    });

    it('should respect TTL_BUMP_THRESHOLD_DAYS environment variable', () => {
      process.env.TTL_BUMP_THRESHOLD_DAYS = '14';
      resetTTLConfig();

      const config = getTTLConfig();
      const expectedSeconds = 14 * 24 * 60 * 60;
      expect(config.bumpThresholdSeconds).toBe(expectedSeconds);
    });

    it('should respect TTL_DEFAULT_EXTENSION_DAYS environment variable', () => {
      process.env.TTL_DEFAULT_EXTENSION_DAYS = '180';
      resetTTLConfig();

      const config = getTTLConfig();
      const expectedSeconds = 180 * 24 * 60 * 60;
      expect(config.defaultTtlExtensionSeconds).toBe(expectedSeconds);
    });

    it('should provide feature flags', () => {
      const config = getTTLConfig();
      expect(typeof config.enableTtlBumping).toBe('boolean');
      expect(typeof config.enableArchival).toBe('boolean');
      expect(typeof config.dryRun).toBe('boolean');
    });

    it('should provide batch and gas parameters', () => {
      const config = getTTLConfig();
      expect(config.batchSize).toBeGreaterThan(0);
      expect(config.maxGasPerBatch).toBeGreaterThan(0);
    });

    it('should provide rate limiting parameters', () => {
      const config = getTTLConfig();
      expect(config.bumpsPerDay).toBeGreaterThan(0);
      expect(config.archivals).toBeGreaterThan(0);
    });

    it('should return consistent config on multiple calls', () => {
      const config1 = getTTLConfig();
      const config2 = getTTLConfig();
      expect(config1).toBe(config2);
    });

    it('should provide getSummary() for logging', () => {
      const config = getTTLConfig();
      const summary = config.getSummary();
      expect(summary).toHaveProperty('bumpThreshold');
      expect(summary).toHaveProperty('defaultTtlExtension');
      expect(summary).toHaveProperty('features');
    });
  });

  describe('TTL time conversions', () => {
    it('should convert hours to milliseconds', () => {
      const config = getTTLConfig();
      // 24 hours
      const expectedMs = 24 * 60 * 60 * 1000;
      expect(config.minBumpIntervalMs).toBe(expectedMs);
    });

    it('should convert archival grace period to milliseconds', () => {
      const config = getTTLConfig();
      // 14 days
      const expectedMs = 14 * 24 * 60 * 60 * 1000;
      expect(config.archivalGracePeriodMs).toBe(expectedMs);
    });

    it('should convert retention window to milliseconds', () => {
      const config = getTTLConfig();
      // 365 days
      const expectedMs = 365 * 24 * 60 * 60 * 1000;
      expect(config.archivalRetentionWindowMs).toBe(expectedMs);
    });
  });

  describe('Configuration validation', () => {
    it('should have positive values for all time intervals', () => {
      const config = getTTLConfig();
      expect(config.bumpThresholdSeconds).toBeGreaterThan(0);
      expect(config.defaultTtlExtensionSeconds).toBeGreaterThan(0);
      expect(config.minBumpIntervalSeconds).toBeGreaterThan(0);
      expect(config.archivalGracePeriodSeconds).toBeGreaterThan(0);
      expect(config.archivalRetentionWindowSeconds).toBeGreaterThan(0);
    });

    it('should have reasonable batch sizes', () => {
      const config = getTTLConfig();
      expect(config.batchSize).toBeGreaterThan(0);
      expect(config.batchSize).toBeLessThan(10000);
    });

    it('should have reasonable gas limits', () => {
      const config = getTTLConfig();
      expect(config.maxGasPerBatch).toBeGreaterThan(0);
      expect(config.maxGasPerBatch).toBeLessThanOrEqual(100000000); // 100M gas
    });

    it('should have reasonable retry configuration', () => {
      const config = getTTLConfig();
      expect(config.retryMaxAttempts).toBeGreaterThan(0);
      expect(config.retryMaxAttempts).toBeLessThanOrEqual(10);
      expect(config.retryBackoffMs).toBeGreaterThan(0);
    });
  });
});
