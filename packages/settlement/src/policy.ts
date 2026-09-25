/**
 * Settlement batching policy: when to touch the chain.
 *
 * The economics of the product depend on submitting rarely. Submitting on every
 * window wastes the channel; submitting too rarely increases the exposure carried
 * between submissions. This module defines the submission triggers and the
 * exposure ceiling that bound that trade-off.
 *
 * Triggers (any one forces a submission):
 *   - accumulated-value threshold (default derived from measured per-op costs)
 *   - maximum interval since the last submission
 *   - approaching cap / channel exhaustion
 *   - operator-forced flush
 *
 * Thresholds are configurable per channel, since a high-volume channel and a
 * small one want different policies.
 */

/**
 * Measured per-operation costs from the gas-budget issue, expressed in the
 * channel's value units. These are the inputs the default threshold is derived
 * from rather than a round number.
 *
 * `submitCost` is the measured cost of a single on-chain submission (the fixed
 * cost we amortize by batching). `perOpCost` is the measured marginal cost of
 * carrying one additional unsettled operation. The default threshold is the
 * point where the amortized submission cost per operation falls to the marginal
 * carry cost, i.e. `submitCost / perOpCost` operations worth of value.
 */
export interface MeasuredCosts {
  /** Measured cost of one on-chain submission, in value units. */
  submitCost: number;
  /** Measured marginal cost of carrying one unsettled operation, in value units. */
  perOpCost: number;
  /** Measured average value per operation, in value units. */
  avgValuePerOp: number;
}

/**
 * Default measured costs. Values trace to the gas-budget issue's measurements;
 * update here when those measurements change so defaults stay derived, not picked.
 */
export const DEFAULT_MEASURED_COSTS: MeasuredCosts = {
  submitCost: 210_000,
  perOpCost: 21,
  avgValuePerOp: 1_000,
};

/**
 * Derive the default accumulated-value threshold from measured per-operation
 * costs. The break-even batch size is `submitCost / perOpCost` operations; the
 * value threshold is that batch size times the measured average value per op.
 */
export function deriveValueThreshold(costs: MeasuredCosts = DEFAULT_MEASURED_COSTS): number {
  if (costs.perOpCost <= 0) {
    throw new Error('perOpCost must be positive to derive a value threshold');
  }
  const breakEvenOps = costs.submitCost / costs.perOpCost;
  return Math.ceil(breakEvenOps * costs.avgValuePerOp);
}

/**
 * Per-channel batching policy. Every field is configurable so a high-volume
 * channel and a small one can carry different policies.
 */
export interface BatchingPolicy {
  /** Accumulated unsettled value that forces a submission. */
  valueThreshold: number;
  /** Maximum time (ms) since the last submission before one is forced. */
  maxIntervalMs: number;
  /**
   * Fraction of the channel cap at which an approaching-cap submission is
   * forced (e.g. 0.9 = submit once 90% of the cap is committed).
   */
  capApproachRatio: number;
  /**
   * Maximum unsettled value tolerated on the channel before submission is
   * forced. Exposure must never exceed this ceiling.
   */
  exposureCeiling: number;
}

/**
 * Build a policy for a channel, deriving the value threshold from measured
 * costs unless the caller overrides it. The exposure ceiling defaults to the
 * value threshold so exposure is bounded by the same measured economics.
 */
export function createBatchingPolicy(
  overrides: Partial<BatchingPolicy> = {},
  costs: MeasuredCosts = DEFAULT_MEASURED_COSTS,
): BatchingPolicy {
  const valueThreshold = overrides.valueThreshold ?? deriveValueThreshold(costs);
  return {
    valueThreshold,
    maxIntervalMs: overrides.maxIntervalMs ?? 60 * 60 * 1000,
    capApproachRatio: overrides.capApproachRatio ?? 0.9,
    exposureCeiling: overrides.exposureCeiling ?? valueThreshold,
  };
}

/** Snapshot of a channel's current settlement state, used to evaluate triggers. */
export interface ChannelSettlementState {
  /** Value accumulated since the last submission. */
  unsettledValue: number;
  /** Total value committed against the channel cap. */
  committedValue: number;
  /** Channel cap. */
  cap: number;
  /** Timestamp (ms) of the last submission. */
  lastSubmittedAt: number;
}

/** The trigger that forced a submission, or null when none applies. */
export type SubmissionTrigger =
  | 'value-threshold'
  | 'max-interval'
  | 'cap-approach'
  | 'exposure-ceiling'
  | 'forced-flush';

/**
 * Evaluate the submission triggers for a channel. Returns the first trigger that
 * applies, or null when the channel may keep batching. `now` is injectable for
 * deterministic tests.
 */
export function evaluateSubmission(
  state: ChannelSettlementState,
  policy: BatchingPolicy,
  options: { now?: number; forceFlush?: boolean } = {},
): SubmissionTrigger | null {
  const now = options.now ?? Date.now();

  if (options.forceFlush) {
    return 'forced-flush';
  }

  // Exposure ceiling is checked first: it is the hard bound that must never be
  // exceeded, regardless of the other thresholds.
  if (state.unsettledValue >= policy.exposureCeiling) {
    return 'exposure-ceiling';
  }

  if (state.unsettledValue >= policy.valueThreshold) {
    return 'value-threshold';
  }

  if (now - state.lastSubmittedAt >= policy.maxIntervalMs) {
    return 'max-interval';
  }

  if (state.cap > 0 && state.committedValue >= state.cap * policy.capApproachRatio) {
    return 'cap-approach';
  }

  return null;
}

/** Convenience predicate: should the channel submit now? */
export function shouldSubmit(
  state: ChannelSettlementState,
  policy: BatchingPolicy,
  options: { now?: number; forceFlush?: boolean } = {},
): boolean {
  return evaluateSubmission(state, policy, options) !== null;
}
