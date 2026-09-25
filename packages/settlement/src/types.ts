/**
 * Shared types for the settlement package.
 *
 * These describe the on-chain channel model, the signed state exchanged
 * between peers, and the batching policy that decides when a channel is
 * submitted to the chain.
 */

/**
 * A single channel between two peers.
 */
export interface Channel {
  /** Unique channel identifier. */
  id: string;
  /** Address of the counterparty. */
  counterparty: string;
  /** Total value currently locked in the channel. */
  capacity: bigint;
  /** Value already settled on-chain. */
  settled: bigint;
  /** Current status of the channel. */
  status: ChannelStatus;
}

export type ChannelStatus = 'open' | 'closing' | 'closed';

/**
 * A signed state update for a channel.
 */
export interface ChannelState {
  channelId: string;
  /** Monotonically increasing sequence number. */
  nonce: bigint;
  /** Cumulative value owed to each party at this nonce. */
  balances: ChannelBalances;
  /** Signature over the canonical encoding of this state. */
  signature?: string;
}

export interface ChannelBalances {
  /** Cumulative amount owed to the local party. */
  local: bigint;
  /** Cumulative amount owed to the remote party. */
  remote: bigint;
}

/**
 * Measured per-operation costs, in wei, used to derive batching defaults.
 *
 * These come from the gas-budget measurements rather than being picked as
 * round numbers, so the default submission threshold tracks the real cost of
 * touching the chain.
 */
export interface OperationCosts {
  /** Cost of submitting a channel update / settlement transaction. */
  submit: bigint;
  /** Cost of a single off-chain operation (signing + bookkeeping). */
  operation: bigint;
}

/**
 * Batching policy for a single channel.
 *
 * A submission is triggered when any of the following holds:
 *  - the accumulated unsettled value reaches `valueThreshold`;
 *  - the time since the last submission reaches `maxIntervalMs`;
 *  - the channel is approaching its cap or is close to exhaustion;
 *  - an operator forces a flush.
 *
 * The `exposureCeiling` is the hard upper bound on unsettled value: once it
 * is reached, submission is forced regardless of the other triggers.
 */
export interface BatchingPolicy {
  /**
   * Accumulated unsettled value that triggers a submission.
   * Derived from measured per-operation costs (see `deriveDefaultPolicy`).
   */
  valueThreshold: bigint;
  /** Maximum time, in milliseconds, between submissions. */
  maxIntervalMs: number;
  /**
   * Fraction of channel capacity at which an approaching-cap submission is
   * triggered, expressed in basis points (e.g. 9000 = 90%).
   */
  capApproachBps: number;
  /**
   * Maximum unsettled value tolerated on the channel before submission is
   * forced. Exposure must never exceed this ceiling.
   */
  exposureCeiling: bigint;
}

/**
 * Per-channel policy overrides. Any field left undefined falls back to the
 * derived default, so a high-volume channel and a small channel can carry
 * different policies.
 */
export type BatchingPolicyOverrides = Partial<BatchingPolicy>;

/**
 * Reason a submission was triggered. Useful for logging and soak tests.
 */
export type SubmissionTrigger =
  | 'value-threshold'
  | 'max-interval'
  | 'cap-approach'
  | 'exposure-ceiling'
  | 'operator-flush';

/**
 * The state tracked per channel to evaluate the batching policy.
 */
export interface BatchingState {
  /** Value accumulated since the last submission. */
  unsettledValue: bigint;
  /** Timestamp (ms) of the last submission. */
  lastSubmittedAt: number;
  /** Effective policy for this channel. */
  policy: BatchingPolicy;
}
