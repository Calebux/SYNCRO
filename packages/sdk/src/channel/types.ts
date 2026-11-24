/**
 * Configuration for automatic channel top-ups.
 */
export interface AutoTopUpConfig {
  /**
   * Whether auto top-up is enabled.
   */
  enabled: boolean;
  /**
   * Amount to top up by when the channel balance falls below the threshold.
   */
  amount: bigint;
  /**
   * Balance threshold below which a top-up is triggered.
   */
  threshold: bigint;
  /**
   * Maximum total amount that may be topped up within a single period.
   * Once this limit is reached, auto top-up stops until the period resets.
   * Defaults to a conservative value.
   */
  maxAmountPerPeriod?: bigint;
  /**
   * Length of the period (in milliseconds) over which `maxAmountPerPeriod`
   * is enforced. Defaults to one hour.
   */
  periodMs?: number;
  /**
   * Maximum number of top-ups allowed per hour. Once this limit is reached,
   * auto top-up stops until the hour resets.
   * Defaults to a conservative value.
   */
  maxTopUpsPerHour?: number;
}

/**
 * Conservative defaults for auto top-up guardrails.
 */
export const DEFAULT_AUTO_TOP_UP_LIMITS = {
  /** Default maximum total top-up amount per period (1 USDC in 6-decimal units). */
  maxAmountPerPeriod: 1_000_000n,
  /** Default period length: one hour. */
  periodMs: 60 * 60 * 1000,
  /** Default maximum number of top-ups per hour. */
  maxTopUpsPerHour: 10,
} as const;

/**
 * Reason an auto top-up was halted by a guardrail.
 */
export type AutoTopUpLimitReason = "maxAmountPerPeriod" | "maxTopUpsPerHour";

/**
 * Event emitted when an auto top-up is halted because a guardrail limit was hit.
 */
export interface AutoTopUpLimitReachedEvent {
  /** Which limit was hit. */
  reason: AutoTopUpLimitReason;
  /** The configured limit value that was reached. */
  limit: bigint | number;
  /** The amount that would have been topped up. */
  attemptedAmount: bigint;
  /** Total amount topped up in the current period at the time the limit was hit. */
  totalAmountInPeriod: bigint;
  /** Number of top-ups performed in the current hour at the time the limit was hit. */
  topUpsInHour: number;
}
