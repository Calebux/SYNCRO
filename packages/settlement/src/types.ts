/**
 * Shared types for the settlement package.
 *
 * These describe the on-chain channel model and the batching policy
 * that decides when a channel is submitted to the chain.
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
 * The signed off-chain state of a channel.
 *
 * This is the payload that peers exchange and sign; it carries the
 * monotonically increasing nonce and the balances each peer is owed.
 */
export interface SignedChannelState {
  /** Channel this state belongs to. */
  channelId: string;
  /** Monotonically increasing version of the state. */
  nonce: number;
  /** Balance owed to each peer, keyed by peer address. */
  balances: Record<string, bigint>;
}

/**
 * The lifecycle of a channel as tracked by the watcher and manager.
 *
 * This describes where the channel is in its open/closing/closed
 * progression, along with the current balance and burn rate used to
 * decide when to submit a settlement.
 */
export interface ChannelLifecycle {
  /** Channel this lifecycle belongs to. */
  channelId: string;
  /** Current status of the channel. */
  status: ChannelStatus;
  /** Total value currently locked in the channel. */
  balance: bigint;
  /** Rate at which the channel balance is being consumed. */
  burnRate: bigint;
}
