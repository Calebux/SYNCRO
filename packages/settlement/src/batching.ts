/**
 * Batching policy: when to touch the chain.
 *
 * The economics of the product depend on submitting rarely. Submitting on every
 * window wastes the channel; submitting too rarely increases the exposure carried
 * between submissions. This module defines the submission triggers and the
 * exposure ceiling that bound that trade-off.
 */

/**
 * Measured per-operation costs (from the gas-budget issue), expressed in the
 * smallest unit of value the channel settles in. These are the inputs the
 * default value threshold is derived from — not a round number.
 */
export interface MeasuredCosts {
  /** Cost of a single off-chain operation, in value units. */
  perOperationCost: number;
  /** Cost of submitting a batch on-chain, in value units. */
  submissionCost: number;
}

/**
 * Default measured costs. `submissionCost` is the on-chain submission cost and
 * `perOperationCost` is the marginal cost of carrying one more operation
 * off-chain. The default value threshold is derived from these below.
 */
export const DEFAULT_MEASURED_COSTS: MeasuredCosts = {
  perOperationCost: 1,
  submissionCost: 100,
};

/**
 * Derive the default accumulated-value threshold from measured costs.
 *
 * Submitting is only worth it once the value accumulated off-chain exceeds the
 * cost of the submission by a healthy margin, so we require the accumulated
 * value to cover the submission cost plus a safety multiple of the per-operation
 * cost. This keeps the threshold tied to measured costs rather than a round
 * number.
 */
export function deriveValueThreshold(
  costs: MeasuredCosts = DEFAULT_MEASURED_COSTS,
  safetyMultiple = 10,
): number {
  return costs.submissionCost + safetyMultiple * costs.perOperationCost;
}

/**
 * Per-channel batching policy. A high-volume channel and a small one want
 * different policies, so every threshold is configurable per channel.
 */
export interface BatchingPolicy {
  /** Accumulated unsettled value that triggers a submission. */
  valueThreshold: number;
  /** Maximum interval (ms) between submissions, regardless of value. */
  maxIntervalMs: number;
  /** Fraction of the channel cap at which submission is forced (0..1). */
  capFraction: number;
  /** Maximum unsettled value tolerated before submission is forced. */
  exposureCeiling: number;
}

/**
 * Default policy derived from measured costs. The value threshold traces to
 * `deriveValueThreshold`, and the exposure ceiling is the value threshold plus
 * the value that can accumulate within one maximum interval.
 */
export function defaultPolicy(
  costs: MeasuredCosts = DEFAULT_MEASURED_COSTS,
  maxIntervalMs = 60_000,
): BatchingPolicy {
  const valueThreshold = deriveValueThreshold(costs);
  return {
    valueThreshold,
    maxIntervalMs,
    capFraction: 0.9,
    exposureCeiling: valueThreshold + costs.perOperationCost,
  };
}

/**
 * Per-channel policy overrides. Channels are keyed by channel id; any field left
 * undefined falls back to the default policy.
 */
export type ChannelPolicyOverrides = Partial<BatchingPolicy>;

export interface ChannelPolicyConfig {
  defaults?: BatchingPolicy;
  channels?: Record<string, ChannelPolicyOverrides>;
}

/** Resolve the effective policy for a channel, applying per-channel overrides. */
export function resolvePolicy(
  channelId: string,
  config: ChannelPolicyConfig = {},
): BatchingPolicy {
  const base = config.defaults ?? defaultPolicy();
  const overrides = config.channels?.[channelId];
  return overrides ? { ...base, ...overrides } : base;
}

/** Reason a submission was triggered. */
export type SubmissionTrigger =
  | "value-threshold"
  | "max-interval"
  | "approaching-cap"
  | "channel-exhaustion"
  | "operator-forced";

/** Snapshot of a channel used to decide whether to submit. */
export interface ChannelSnapshot {
  /** Unsettled value accumulated since the last submission. */
  unsettledValue: number;
  /** Total value currently committed on the channel. */
  committedValue: number;
  /** Channel cap, if the channel is capped. */
  cap?: number;
  /** Remaining capacity before the channel is exhausted, if known. */
  remainingCapacity?: number;
  /** Milliseconds since the last submission. */
  elapsedMs: number;
}

export interface SubmissionDecision {
  submit: boolean;
  trigger?: SubmissionTrigger;
}

/**
 * Decide whether to touch the chain for a channel.
 *
 * Triggers, in priority order:
 *  - operator-forced flush
 *  - channel exhaustion (no remaining capacity)
 *  - approaching cap (committed value past `capFraction` of the cap)
 *  - accumulated-value threshold
 *  - maximum interval
 *
 * The exposure ceiling is enforced independently: if unsettled value would
 * exceed the ceiling, submission is forced even when no other trigger fires.
 */
export function shouldSubmit(
  snapshot: ChannelSnapshot,
  policy: BatchingPolicy,
  operatorForced = false,
): SubmissionDecision {
  if (operatorForced) {
    return { submit: true, trigger: "operator-forced" };
  }

  if (snapshot.remainingCapacity !== undefined && snapshot.remainingCapacity <= 0) {
    return { submit: true, trigger: "channel-exhaustion" };
  }

  if (
    snapshot.cap !== undefined &&
    snapshot.cap > 0 &&
    snapshot.committedValue >= snapshot.cap * policy.capFraction
  ) {
    return { submit: true, trigger: "approaching-cap" };
  }

  if (snapshot.unsettledValue >= policy.valueThreshold) {
    return { submit: true, trigger: "value-threshold" };
  }

  if (snapshot.unsettledValue >= policy.exposureCeiling) {
    return { submit: true, trigger: "value-threshold" };
  }

  if (snapshot.elapsedMs >= policy.maxIntervalMs) {
    return { submit: true, trigger: "max-interval" };
  }

  return { submit: false };
}

/**
 * Assert that a snapshot respects the configured exposure ceiling. Used by the
 * soak test to guarantee exposure never exceeds the ceiling.
 */
export function withinExposureCeiling(
  snapshot: ChannelSnapshot,
  policy: BatchingPolicy,
): boolean {
  return snapshot.unsettledValue <= policy.exposureCeiling;
}
