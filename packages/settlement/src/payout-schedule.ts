/**
 * Provider Payout Schedules and Minimum Payout Thresholds (#1859).
 *
 * Providers want control over when they are paid (daily, weekly, or threshold-only)
 * to avoid receiving micro-transactions / dust payouts.
 *
 * Features:
 * - Per-provider payout schedules ('daily', 'weekly', 'threshold_only') and minimum amount threshold.
 * - Accumulates earnings below threshold, rolling over until threshold is reached.
 * - Maximum hold period (default 30 days): triggers payout even if threshold isn't met.
 * - Provider console upcoming payout estimation and lifecycle tracking.
 */

export type PayoutScheduleFrequency = 'daily' | 'weekly' | 'threshold_only';

export interface ProviderPayoutConfig {
  providerId: string;
  schedule: PayoutScheduleFrequency;
  minimumThreshold: bigint;
  maxHoldPeriodMs?: number;
  payoutAddress?: string;
}

export const DEFAULT_MIN_THRESHOLD = 50_000n;
export const DEFAULT_MAX_HOLD_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface PayoutEvaluationResult {
  payoutDue: boolean;
  payoutAmount: bigint;
  remainingRollover: bigint;
  reason?: 'threshold_met' | 'schedule_due' | 'max_hold_exceeded';
  nextScheduledTime?: number;
}

export interface UpcomingPayoutInfo {
  providerId: string;
  accumulatedBalance: bigint;
  minimumThreshold: bigint;
  thresholdReached: boolean;
  progressPercentage: number;
  payoutDue: boolean;
  payoutAmount: bigint;
  nextScheduledPayout: number | null;
  maxHoldDeadline: number | null;
  schedule: PayoutScheduleFrequency;
}

export interface ProviderAccountState {
  config: ProviderPayoutConfig;
  accumulatedBalance: bigint;
  lastPayoutTimestamp: number;
  firstAccumulatedTimestamp: number | null;
}

export class ProviderPayoutManager {
  private readonly accounts = new Map<string, ProviderAccountState>();

  /**
   * Configure or update payout schedule and threshold for a provider.
   */
  configureProvider(config: ProviderPayoutConfig): void {
    if (config.minimumThreshold <= 0n) {
      throw new Error('minimumThreshold must be greater than zero');
    }

    const existing = this.accounts.get(config.providerId);
    if (existing) {
      existing.config = {
        ...config,
        maxHoldPeriodMs: config.maxHoldPeriodMs ?? DEFAULT_MAX_HOLD_PERIOD_MS,
      };
    } else {
      this.accounts.set(config.providerId, {
        config: {
          ...config,
          maxHoldPeriodMs: config.maxHoldPeriodMs ?? DEFAULT_MAX_HOLD_PERIOD_MS,
        },
        accumulatedBalance: 0n,
        lastPayoutTimestamp: Date.now(),
        firstAccumulatedTimestamp: null,
      });
    }
  }

  /**
   * Get provider configuration or return a default configuration.
   */
  getProviderConfig(providerId: string): ProviderPayoutConfig {
    const account = this.accounts.get(providerId);
    if (account) {
      return account.config;
    }
    return {
      providerId,
      schedule: 'threshold_only',
      minimumThreshold: DEFAULT_MIN_THRESHOLD,
      maxHoldPeriodMs: DEFAULT_MAX_HOLD_PERIOD_MS,
    };
  }

  /**
   * Credit earnings to a provider's accumulated balance and evaluate payout conditions.
   */
  creditEarnings(
    providerId: string,
    amount: bigint,
    now: number = Date.now(),
  ): PayoutEvaluationResult {
    if (amount <= 0n) {
      throw new Error('earning amount must be positive');
    }

    let account = this.accounts.get(providerId);
    if (!account) {
      this.configureProvider({
        providerId,
        schedule: 'threshold_only',
        minimumThreshold: DEFAULT_MIN_THRESHOLD,
      });
      account = this.accounts.get(providerId)!;
    }

    account.accumulatedBalance += amount;
    if (account.firstAccumulatedTimestamp === null) {
      account.firstAccumulatedTimestamp = now;
    }

    return this.evaluatePayout(providerId, now);
  }

  /**
   * Evaluate whether a payout is due for a provider based on threshold, schedule, and max hold period.
   */
  evaluatePayout(providerId: string, now: number = Date.now()): PayoutEvaluationResult {
    const account = this.accounts.get(providerId);
    if (!account || account.accumulatedBalance === 0n) {
      return {
        payoutDue: false,
        payoutAmount: 0n,
        remainingRollover: 0n,
      };
    }

    const { schedule, minimumThreshold, maxHoldPeriodMs = DEFAULT_MAX_HOLD_PERIOD_MS } =
      account.config;
    const balance = account.accumulatedBalance;
    const firstAccrual = account.firstAccumulatedTimestamp ?? now;
    const timeSinceFirstAccrual = now - firstAccrual;
    const timeSinceLastPayout = now - account.lastPayoutTimestamp;

    // 1. Check Max Hold Period Exceeded: forced payout even if below threshold
    if (timeSinceFirstAccrual >= maxHoldPeriodMs && balance > 0n) {
      const payoutAmount = balance;
      account.accumulatedBalance = 0n;
      account.lastPayoutTimestamp = now;
      account.firstAccumulatedTimestamp = null;

      return {
        payoutDue: true,
        payoutAmount,
        remainingRollover: 0n,
        reason: 'max_hold_exceeded',
      };
    }

    // 2. Check if balance meets minimum threshold
    const thresholdMet = balance >= minimumThreshold;

    if (!thresholdMet) {
      // Balance is below threshold -> rolls over
      let nextScheduledTime: number | undefined;
      if (account.firstAccumulatedTimestamp !== null) {
        nextScheduledTime = account.firstAccumulatedTimestamp + maxHoldPeriodMs;
      }

      return {
        payoutDue: false,
        payoutAmount: 0n,
        remainingRollover: balance,
        nextScheduledTime,
      };
    }

    // 3. Threshold is met: evaluate schedule frequency
    if (schedule === 'threshold_only') {
      const payoutAmount = balance;
      account.accumulatedBalance = 0n;
      account.lastPayoutTimestamp = now;
      account.firstAccumulatedTimestamp = null;

      return {
        payoutDue: true,
        payoutAmount,
        remainingRollover: 0n,
        reason: 'threshold_met',
      };
    }

    if (schedule === 'daily') {
      const isDue = timeSinceLastPayout >= ONE_DAY_MS;
      if (isDue) {
        const payoutAmount = balance;
        account.accumulatedBalance = 0n;
        account.lastPayoutTimestamp = now;
        account.firstAccumulatedTimestamp = null;

        return {
          payoutDue: true,
          payoutAmount,
          remainingRollover: 0n,
          reason: 'schedule_due',
        };
      }
      return {
        payoutDue: false,
        payoutAmount: 0n,
        remainingRollover: balance,
        nextScheduledTime: account.lastPayoutTimestamp + ONE_DAY_MS,
      };
    }

    if (schedule === 'weekly') {
      const isDue = timeSinceLastPayout >= ONE_WEEK_MS;
      if (isDue) {
        const payoutAmount = balance;
        account.accumulatedBalance = 0n;
        account.lastPayoutTimestamp = now;
        account.firstAccumulatedTimestamp = null;

        return {
          payoutDue: true,
          payoutAmount,
          remainingRollover: 0n,
          reason: 'schedule_due',
        };
      }
      return {
        payoutDue: false,
        payoutAmount: 0n,
        remainingRollover: balance,
        nextScheduledTime: account.lastPayoutTimestamp + ONE_WEEK_MS,
      };
    }

    return {
      payoutDue: false,
      payoutAmount: 0n,
      remainingRollover: balance,
    };
  }

  /**
   * Helper for provider console / dashboard showing upcoming payout preview.
   */
  getUpcomingPayouts(providerId: string, now: number = Date.now()): UpcomingPayoutInfo {
    const account = this.accounts.get(providerId);
    if (!account) {
      return {
        providerId,
        accumulatedBalance: 0n,
        minimumThreshold: DEFAULT_MIN_THRESHOLD,
        thresholdReached: false,
        progressPercentage: 0,
        payoutDue: false,
        payoutAmount: 0n,
        nextScheduledPayout: null,
        maxHoldDeadline: null,
        schedule: 'threshold_only',
      };
    }

    const { config, accumulatedBalance, lastPayoutTimestamp, firstAccumulatedTimestamp } = account;
    const thresholdReached = accumulatedBalance >= config.minimumThreshold;
    const progress =
      config.minimumThreshold > 0n
        ? Math.min(100, Number((accumulatedBalance * 100n) / config.minimumThreshold))
        : 100;

    let nextScheduled: number | null = null;
    if (config.schedule === 'daily') {
      nextScheduled = lastPayoutTimestamp + ONE_DAY_MS;
    } else if (config.schedule === 'weekly') {
      nextScheduled = lastPayoutTimestamp + ONE_WEEK_MS;
    }

    const maxHoldDeadline = firstAccumulatedTimestamp
      ? firstAccumulatedTimestamp + (config.maxHoldPeriodMs ?? DEFAULT_MAX_HOLD_PERIOD_MS)
      : null;

    const evaluation = this.evaluatePayout(providerId, now);

    return {
      providerId,
      accumulatedBalance,
      minimumThreshold: config.minimumThreshold,
      thresholdReached,
      progressPercentage: progress,
      payoutDue: evaluation.payoutDue,
      payoutAmount: evaluation.payoutDue ? evaluation.payoutAmount : 0n,
      nextScheduledPayout: nextScheduled,
      maxHoldDeadline,
      schedule: config.schedule,
    };
  }
}
