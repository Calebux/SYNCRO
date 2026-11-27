import { EventEmitter } from 'events';
import type { AutoTopUpConfig } from '@cascade/settlement';

export interface ChannelClientOptions {
  autoTopUp?: AutoTopUpConfig;
  now?: () => number;
}

export interface AutoTopUpLimitEvent {
  reason: 'maxAmountPerPeriod' | 'maxTopUpsPerHour';
  limit: number;
  observed: number;
  timestamp: number;
}

/** Conservative defaults applied when the caller does not configure limits. */
export const DEFAULT_MAX_TOP_UP_AMOUNT_PER_PERIOD = 10_000n;
export const DEFAULT_MAX_TOP_UPS_PER_HOUR = 6;
const ONE_HOUR_MS = 60 * 60 * 1000;

export class ChannelClient extends EventEmitter {
  private readonly autoTopUp?: AutoTopUpConfig;
  private readonly now: () => number;
  private periodStart: number;
  private periodAmount = 0n;
  private topUpTimestamps: number[] = [];
  private autoTopUpStopped = false;

  constructor(options: ChannelClientOptions = {}) {
    super();
    this.autoTopUp = options.autoTopUp;
    this.now = options.now ?? Date.now;
    this.periodStart = this.now();
  }

  /**
   * Attempt an auto top-up. Returns true when the top-up was performed, false
   * when a guardrail stopped it. Emits `autoTopUpLimitReached` on the client
   * when a limit is hit and disables further auto top-ups.
   */
  async maybeAutoTopUp(amount: bigint): Promise<boolean> {
    if (!this.autoTopUp || this.autoTopUpStopped) {
      return false;
    }

    const now = this.now();
    this.rollPeriod(now);

    const maxAmountPerPeriod =
      this.autoTopUp.maxAmountPerPeriod ?? DEFAULT_MAX_TOP_UP_AMOUNT_PER_PERIOD;
    const maxTopUpsPerHour =
      this.autoTopUp.maxTopUpsPerHour ?? DEFAULT_MAX_TOP_UPS_PER_HOUR;

    const nextPeriodAmount = this.periodAmount + amount;
    if (nextPeriodAmount > maxAmountPerPeriod) {
      this.stopAutoTopUp('maxAmountPerPeriod', maxAmountPerPeriod, nextPeriodAmount, now);
      return false;
    }

    this.pruneTopUpTimestamps(now);
    if (this.topUpTimestamps.length + 1 > maxTopUpsPerHour) {
      this.stopAutoTopUp(
        'maxTopUpsPerHour',
        maxTopUpsPerHour,
        this.topUpTimestamps.length + 1,
        now,
      );
      return false;
    }

    this.periodAmount = nextPeriodAmount;
    this.topUpTimestamps.push(now);
    return true;
  }

  private rollPeriod(now: number): void {
    if (now - this.periodStart >= ONE_HOUR_MS) {
      this.periodStart = now;
      this.periodAmount = 0n;
    }
  }

  private pruneTopUpTimestamps(now: number): void {
    const cutoff = now - ONE_HOUR_MS;
    this.topUpTimestamps = this.topUpTimestamps.filter((ts) => ts > cutoff);
  }

  private stopAutoTopUp(
    reason: AutoTopUpLimitEvent['reason'],
    limit: number | bigint,
    observed: number | bigint,
    timestamp: number,
  ): void {
    this.autoTopUpStopped = true;
    const event: AutoTopUpLimitEvent = {
      reason,
      limit: Number(limit),
      observed: Number(observed),
      timestamp,
    };
    this.emit('autoTopUpLimitReached', event);
  }
}
