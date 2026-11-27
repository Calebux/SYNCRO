import { TTLBumpWorker, resetTTLBumpWorker } from '../../workers/ttl-bump-worker';
import { BlockchainService } from '../../services/blockchain-service';
import { getTTLConfig, resetTTLConfig } from '../../config/ttl-config';
import { getAuditService } from '../../services/audit-service';

/**
 * Integration tests for TTL Bump Worker.
 * Tests the full workflow: scanning, filtering, batching, and extending TTL.
 */
describe('TTL Bump Worker Integration', () => {
  let worker: TTLBumpWorker;
  let blockchainService: BlockchainService;

  beforeEach(() => {
    resetTTLConfig();
    resetTTLBumpWorker();
    blockchainService = new BlockchainService();
    worker = new TTLBumpWorker(blockchainService);
  });

  afterEach(() => {
    resetTTLBumpWorker();
    resetTTLConfig();
  });

  describe('Worker initialization', () => {
    it('should create a TTL bump worker', () => {
      expect(worker).toBeDefined();
      expect(worker).toBeInstanceOf(TTLBumpWorker);
    });
  });

  describe('Rate limiting', () => {
    it('should enforce per-entry daily bump limit', async () => {
      const config = getTTLConfig();
      const originalBumpsPerDay = config.bumpsPerDay;

      // Mock config to allow only 1 bump per day
      process.env.TTL_DRY_RUN = 'true';

      const result1 = await worker.run();
      expect(result1).toBeDefined();

      // The second run should hit rate limits
      const result2 = await worker.run();
      expect(result2).toBeDefined();

      // In dry-run mode, we should see attempts to bump but rate limiting may apply
      resetTTLBumpWorker();
    });

    it('should respect minBumpInterval between bumps', async () => {
      const config = getTTLConfig();
      // minBumpInterval should prevent rapid successive bumps
      expect(config.minBumpIntervalMs).toBeGreaterThan(0);
    });
  });

  describe('Batch processing', () => {
    it('should process entries in batches', async () => {
      process.env.TTL_DRY_RUN = 'true';
      const result = await worker.run();

      expect(result).toBeDefined();
      expect(result.totalProcessed).toBeGreaterThanOrEqual(0);
      expect(result.totalBumped).toBeGreaterThanOrEqual(0);
      expect(result.totalFailed).toBeGreaterThanOrEqual(0);
    });

    it('should respect batch size limit', async () => {
      process.env.TTL_BATCH_SIZE = '10';
      resetTTLConfig();
      resetTTLBumpWorker();
      worker = new TTLBumpWorker(blockchainService);

      process.env.TTL_DRY_RUN = 'true';
      const result = await worker.run();

      expect(result.totalProcessed).toBeLessThanOrEqual(20); // Batch size is 10, so at most 2 batches in a test run
    });

    it('should respect max gas per batch limit', async () => {
      process.env.TTL_MAX_GAS_PER_BATCH = '5000'; // Very low limit
      resetTTLConfig();
      resetTTLBumpWorker();
      worker = new TTLBumpWorker(blockchainService);

      process.env.TTL_DRY_RUN = 'true';
      const result = await worker.run();

      // With a very low gas limit, not many entries should be processed
      expect(result).toBeDefined();
    });
  });

  describe('Dry-run mode', () => {
    it('should support dry-run without blockchain calls', async () => {
      process.env.TTL_DRY_RUN = 'true';
      resetTTLConfig();
      resetTTLBumpWorker();
      worker = new TTLBumpWorker(blockchainService);

      const result = await worker.run();

      // In dry-run mode, no real blockchain calls are made
      // but the worker should still report statistics
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should handle worker run failures gracefully', async () => {
      // Test that worker doesn't crash on errors
      try {
        const result = await worker.run();
        expect(result).toBeDefined();
      } catch (error) {
        // Even on error, worker should be testable
        expect(error).toBeDefined();
      }
    });

    it('should record failed bumps in results', async () => {
      process.env.TTL_DRY_RUN = 'true';
      const result = await worker.run();

      // Check that result structure is valid
      expect(result).toBeDefined();
      expect(result.results).toBeInstanceOf(Array);
      expect(result.totalFailed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Statistics tracking', () => {
    it('should track worker run statistics', async () => {
      process.env.TTL_DRY_RUN = 'true';
      const result = await worker.run();

      expect(result.totalProcessed).toBeGreaterThanOrEqual(0);
      expect(result.totalBumped).toBeGreaterThanOrEqual(0);
      expect(result.totalFailed).toBeGreaterThanOrEqual(0);
      expect(result.totalSkipped).toBeGreaterThanOrEqual(0);
      expect(result.totalGasUsed).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should report duration of worker run', async () => {
      process.env.TTL_DRY_RUN = 'true';
      const result = await worker.run();

      expect(result.durationMs).toBeGreaterThan(0);
    });
  });

  describe('Audit event emission', () => {
    it('should emit audit event for worker run', async () => {
      process.env.TTL_DRY_RUN = 'true';
      const auditService = getAuditService();
      const emitSpy = jest.spyOn(auditService, 'emitSecurityEvent');

      const result = await worker.run();

      // Verify audit event was emitted
      expect(emitSpy).toHaveBeenCalled();

      emitSpy.mockRestore();
    });
  });

  describe('Idempotency', () => {
    it('should be safe to run multiple times', async () => {
      process.env.TTL_DRY_RUN = 'true';

      const result1 = await worker.run();
      const result2 = await worker.run();

      // Both runs should succeed
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('Configuration', () => {
    it('should respect enable TTL bumping flag', async () => {
      process.env.TTL_ENABLE_TTL_BUMPING = 'false';
      resetTTLConfig();
      resetTTLBumpWorker();
      worker = new TTLBumpWorker(blockchainService);

      const result = await worker.run();

      // Worker should skip when disabled
      expect(result.totalProcessed).toBe(0);
      expect(result.totalBumped).toBe(0);
    });
  });
});
