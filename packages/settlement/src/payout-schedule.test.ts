import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProviderPayoutManager,
  ONE_DAY_MS,
  ONE_WEEK_MS,
  DEFAULT_MAX_HOLD_PERIOD_MS,
} from './payout-schedule';

describe('Provider Payout Schedules & Minimum Thresholds (#1859)', () => {
  let manager: ProviderPayoutManager;
  const providerId = 'provider-stellar-compute-1';
  const baseTime = 1_700_000_000_000;

  beforeEach(() => {
    manager = new ProviderPayoutManager();
  });

  describe('Below-threshold rollover and threshold payouts', () => {
    it('rolls over earnings below threshold without triggering payout', () => {
      manager.configureProvider({
        providerId,
        schedule: 'threshold_only',
        minimumThreshold: 100_000n,
      });

      // Credit 30k (below 100k threshold)
      const res1 = manager.creditEarnings(providerId, 30_000n, baseTime);
      expect(res1.payoutDue).toBe(false);
      expect(res1.payoutAmount).toBe(0n);
      expect(res1.remainingRollover).toBe(30_000n);

      // Credit another 40k (total 70k, still below 100k threshold)
      const res2 = manager.creditEarnings(providerId, 40_000n, baseTime + 1000);
      expect(res2.payoutDue).toBe(false);
      expect(res2.payoutAmount).toBe(0n);
      expect(res2.remainingRollover).toBe(70_000n);
    });

    it('triggers payout once accumulated earnings cross the minimum threshold', () => {
      manager.configureProvider({
        providerId,
        schedule: 'threshold_only',
        minimumThreshold: 100_000n,
      });

      manager.creditEarnings(providerId, 60_000n, baseTime);
      // Crossing threshold: credit 50k (total 110k >= 100k)
      const res = manager.creditEarnings(providerId, 50_000n, baseTime + 5000);

      expect(res.payoutDue).toBe(true);
      expect(res.payoutAmount).toBe(110_000n);
      expect(res.remainingRollover).toBe(0n);
      expect(res.reason).toBe('threshold_met');
    });
  });

  describe('Payout Schedules (Daily, Weekly)', () => {
    it('applies daily schedule: rolls over until 24 hours have elapsed even if threshold is met', () => {
      manager.configureProvider({
        providerId,
        schedule: 'daily',
        minimumThreshold: 50_000n,
      });

      // Credit 100k (threshold met, but same day)
      const res1 = manager.creditEarnings(providerId, 100_000n, baseTime);
      expect(res1.payoutDue).toBe(false);
      expect(res1.remainingRollover).toBe(100_000n);

      // Advance time by 25 hours (daily schedule due)
      const res2 = manager.evaluatePayout(providerId, baseTime + ONE_DAY_MS + 3600_000);
      expect(res2.payoutDue).toBe(true);
      expect(res2.payoutAmount).toBe(100_000n);
      expect(res2.remainingRollover).toBe(0n);
      expect(res2.reason).toBe('schedule_due');
    });

    it('applies weekly schedule: triggers payout once a week has elapsed and threshold is met', () => {
      manager.configureProvider({
        providerId,
        schedule: 'weekly',
        minimumThreshold: 50_000n,
      });

      manager.creditEarnings(providerId, 80_000n, baseTime);

      // Check after 3 days -> not due
      const checkMidweek = manager.evaluatePayout(providerId, baseTime + 3 * ONE_DAY_MS);
      expect(checkMidweek.payoutDue).toBe(false);

      // Check after 7.5 days -> due
      const checkWeek = manager.evaluatePayout(providerId, baseTime + ONE_WEEK_MS + 3600_000);
      expect(checkWeek.payoutDue).toBe(true);
      expect(checkWeek.payoutAmount).toBe(80_000n);
      expect(checkWeek.reason).toBe('schedule_due');
    });
  });

  describe('Maximum Hold Period Exceeded', () => {
    it('forces payout when max hold period expires, even if threshold is not reached', () => {
      manager.configureProvider({
        providerId,
        schedule: 'threshold_only',
        minimumThreshold: 500_000n,
        maxHoldPeriodMs: DEFAULT_MAX_HOLD_PERIOD_MS, // 30 days
      });

      // Provider only earned 20_000n (far below 500k)
      manager.creditEarnings(providerId, 20_000n, baseTime);

      // At day 29, no payout
      const day29 = manager.evaluatePayout(providerId, baseTime + 29 * ONE_DAY_MS);
      expect(day29.payoutDue).toBe(false);

      // At day 31 (max hold exceeded), forced payout triggered to prevent indefinite lockup
      const day31 = manager.evaluatePayout(providerId, baseTime + 31 * ONE_DAY_MS);
      expect(day31.payoutDue).toBe(true);
      expect(day31.payoutAmount).toBe(20_000n);
      expect(day31.reason).toBe('max_hold_exceeded');
    });
  });

  describe('Provider Console Upcoming Payout Info', () => {
    it('returns progress percentage, rollover balance, and schedule metadata', () => {
      manager.configureProvider({
        providerId,
        schedule: 'daily',
        minimumThreshold: 100_000n,
      });

      manager.creditEarnings(providerId, 50_000n, baseTime);
      const info = manager.getUpcomingPayouts(providerId, baseTime);

      expect(info.providerId).toBe(providerId);
      expect(info.accumulatedBalance).toBe(50_000n);
      expect(info.minimumThreshold).toBe(100_000n);
      expect(info.thresholdReached).toBe(false);
      expect(info.progressPercentage).toBe(50);
      expect(info.schedule).toBe('daily');
      expect(info.nextScheduledPayout).toBe(baseTime + ONE_DAY_MS);
      expect(info.maxHoldDeadline).toBe(baseTime + DEFAULT_MAX_HOLD_PERIOD_MS);
    });
  });
});
