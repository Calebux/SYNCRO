import '@jest/globals';
import { daysSince, isExpiredByInactivity, daysUntilExpiry } from '../src/utils/expiry';
import { generateCycleId } from '../src/utils/cycle-id';

// Mock Supabase
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

// Mock logger
jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

describe('Validation Methods and Utilities', () => {
  describe('expiry.ts - Validation Functions', () => {
    describe('daysSince()', () => {
      it('should calculate days elapsed correctly for string dates', () => {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 10);
        const pastDateString = pastDate.toISOString();

        const days = daysSince(pastDateString);

        expect(days).toBe(10);
      });

      it('should calculate days elapsed correctly for Date objects', () => {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 5);

        const days = daysSince(pastDate);

        expect(days).toBe(5);
      });

      it('should return 0 for today', () => {
        const today = new Date();
        const days = daysSince(today);

        expect(days).toBe(0);
      });

      it('should handle dates far in the past', () => {
        const veryOldDate = new Date('2020-01-01');
        const days = daysSince(veryOldDate);

        expect(days).toBeGreaterThan(1000);
      });

      it('should round down to whole days', () => {
        const now = new Date();
        const almostYesterday = new Date(now.getTime() - 1000 * 60 * 60 * 23.5); // 23.5 hours ago

        const days = daysSince(almostYesterday);

        expect(days).toBe(0);
      });
    });

    describe('isExpiredByInactivity()', () => {
      it('should return true when past threshold using last_used_at', () => {
        const lastUsedDate = new Date();
        lastUsedDate.setDate(lastUsedDate.getDate() - 100);

        const isExpired = isExpiredByInactivity(
          lastUsedDate.toISOString(),
          new Date().toISOString(),
          60 // 60 days threshold
        );

        expect(isExpired).toBe(true);
      });

      it('should return false when within threshold using last_used_at', () => {
        const lastUsedDate = new Date();
        lastUsedDate.setDate(lastUsedDate.getDate() - 30);

        const isExpired = isExpiredByInactivity(
          lastUsedDate.toISOString(),
          new Date().toISOString(),
          60 // 60 days threshold
        );

        expect(isExpired).toBe(false);
      });

      it('should use created_at when last_used_at is null', () => {
        const createdDate = new Date();
        createdDate.setDate(createdDate.getDate() - 100);

        const isExpired = isExpiredByInactivity(
          null,
          createdDate.toISOString(),
          60 // 60 days threshold
        );

        expect(isExpired).toBe(true);
      });

      it('should return true at exact threshold boundary', () => {
        const refDate = new Date();
        refDate.setDate(refDate.getDate() - 60);

        const isExpired = isExpiredByInactivity(
          refDate.toISOString(),
          new Date().toISOString(),
          60
        );

        expect(isExpired).toBe(true);
      });

      it('should return false just before threshold', () => {
        const refDate = new Date();
        refDate.setDate(refDate.getDate() - 59);

        const isExpired = isExpiredByInactivity(
          refDate.toISOString(),
          new Date().toISOString(),
          60
        );

        expect(isExpired).toBe(false);
      });
    });

    describe('daysUntilExpiry()', () => {
      it('should return positive value when within threshold', () => {
        const lastUsedDate = new Date();
        lastUsedDate.setDate(lastUsedDate.getDate() - 20);

        const daysRemaining = daysUntilExpiry(
          lastUsedDate.toISOString(),
          new Date().toISOString(),
          60
        );

        expect(daysRemaining).toBe(40);
      });

      it('should return negative value when past threshold', () => {
        const lastUsedDate = new Date();
        lastUsedDate.setDate(lastUsedDate.getDate() - 100);

        const daysRemaining = daysUntilExpiry(
          lastUsedDate.toISOString(),
          new Date().toISOString(),
          60
        );

        expect(daysRemaining).toBeLessThan(0);
      });

      it('should return 0 at exact threshold', () => {
        const refDate = new Date();
        refDate.setDate(refDate.getDate() - 60);

        const daysRemaining = daysUntilExpiry(
          refDate.toISOString(),
          new Date().toISOString(),
          60
        );

        expect(daysRemaining).toBe(0);
      });

      it('should use created_at as fallback when last_used_at is null', () => {
        const createdDate = new Date();
        createdDate.setDate(createdDate.getDate() - 20);

        const daysRemaining = daysUntilExpiry(
          null,
          createdDate.toISOString(),
          60
        );

        expect(daysRemaining).toBe(40);
      });

      it('should calculate correctly for small threshold values', () => {
        const refDate = new Date();
        refDate.setDate(refDate.getDate() - 5);

        const daysRemaining = daysUntilExpiry(
          refDate.toISOString(),
          new Date().toISOString(),
          10
        );

        expect(daysRemaining).toBe(5);
      });
    });
  });

  describe('cycle-id.ts - Cycle ID Generation', () => {
    describe('generateCycleId()', () => {
      it('should generate correct cycle ID from Date object', () => {
        const date = new Date('2026-03-15T10:30:00Z');
        const cycleId = generateCycleId(date);

        expect(cycleId).toBe(20260315);
      });

      it('should generate correct cycle ID from ISO string', () => {
        const dateString = '2026-03-15T10:30:00Z';
        const cycleId = generateCycleId(dateString);

        expect(cycleId).toBe(20260315);
      });

      it('should generate correct cycle ID for January dates', () => {
        const date = new Date('2026-01-05T00:00:00Z');
        const cycleId = generateCycleId(date);

        expect(cycleId).toBe(20260105);
      });

      it('should generate correct cycle ID for December dates', () => {
        const date = new Date('2026-12-25T00:00:00Z');
        const cycleId = generateCycleId(date);

        expect(cycleId).toBe(20261225);
      });

      it('should use UTC timezone exclusively', () => {
        // Create a date and be explicit about timezone
        const date = new Date('2026-03-15T23:59:59Z');
        const cycleId = generateCycleId(date);

        // Should be the same regardless of local timezone
        expect(cycleId).toBe(20260315);
      });

      it('should throw error for invalid date strings', () => {
        expect(() => {
          generateCycleId('invalid-date');
        }).toThrow('Invalid date');
      });

      it('should throw error for null values', () => {
        expect(() => {
          generateCycleId(null as any);
        }).toThrow();
      });

      it('should handle single digit months and days', () => {
        const date = new Date('2026-01-01T00:00:00Z');
        const cycleId = generateCycleId(date);

        expect(cycleId).toBe(20260101);
      });

      it('should generate deterministic results for same date', () => {
        const date = new Date('2026-03-15T10:30:00Z');
        const cycleId1 = generateCycleId(date);
        const cycleId2 = generateCycleId(date);

        expect(cycleId1).toBe(cycleId2);
      });

      it('should generate different cycle IDs for different dates', () => {
        const date1 = new Date('2026-03-15T00:00:00Z');
        const date2 = new Date('2026-03-16T00:00:00Z');

        const cycleId1 = generateCycleId(date1);
        const cycleId2 = generateCycleId(date2);

        expect(cycleId1).not.toBe(cycleId2);
        // Mar 15 = 20260315, Mar 16 = 20260316
        expect(cycleId1).toBe(20260315);
        expect(cycleId2).toBe(20260316);
      });

      it('should generate different cycle IDs for different years', () => {
        const date1 = new Date('2025-12-31T00:00:00Z');
        const date2 = new Date('2026-01-01T00:00:00Z');

        const cycleId1 = generateCycleId(date1);
        const cycleId2 = generateCycleId(date2);

        expect(cycleId1).not.toBe(cycleId2);
        // 2025-12-31 = 20251231, 2026-01-01 = 20260101
        expect(cycleId1).toBe(20251231);
        expect(cycleId2).toBe(20260101);
      });

      it('should generate valid 8-digit numbers', () => {
        const date = new Date('2026-03-15T00:00:00Z');
        const cycleId = generateCycleId(date);

        expect(cycleId.toString().length).toBe(8);
        expect(cycleId).toBeGreaterThanOrEqual(10000000);
        expect(cycleId).toBeLessThanOrEqual(99999999);
      });
    });
  });

  describe('Input Validation Edge Cases', () => {
    it('should handle very old dates in expiry calculations', () => {
      const veryOldDate = new Date('1900-01-01');
      const days = daysSince(veryOldDate);

      expect(days).toBeGreaterThan(40000);
    });

    it('should handle future dates in cycle ID generation', () => {
      const futureDate = new Date('2099-12-31T00:00:00Z');
      const cycleId = generateCycleId(futureDate);

      expect(cycleId).toBe(20991231);
    });

    it('should handle leap year dates correctly', () => {
      const leapYearDate = new Date('2024-02-29T00:00:00Z');
      const cycleId = generateCycleId(leapYearDate);

      expect(cycleId).toBe(20240229);
    });

    it('should maintain consistency across timezone boundaries', () => {
      const isoString = '2026-03-15T00:00:00Z';
      const cycleId1 = generateCycleId(isoString);
      const cycleId2 = generateCycleId(new Date(isoString));

      expect(cycleId1).toBe(cycleId2);
    });
  });
});
