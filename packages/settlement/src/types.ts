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
