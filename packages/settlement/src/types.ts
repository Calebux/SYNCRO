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
 * The full v3 channel state that is encoded and signed.
 *
 * Both the TypeScript settlement layer and the Rust `syncro-channel-state`
 * crate use this exact field set when producing the canonical encoding:
 *
 * ```
 * v3-channel-state|{contractVersion}|{contractAddress}|{channelId}|{nonce}|{payerBalance}|{payeeBalance}|{windowStart}|{windowEnd}
 * ```
 *
 * `contractVersion` is a string because the on-chain contract stores it as a
 * string; callers should pass `"1"`, `"2"`, etc.
 */
export interface ChannelState {
  /** Unique channel identifier. */
  channelId: string;
  /** Stellar address of the payment-channel contract. */
  contractAddress: string;
  /**
   * Version of the payment-channel contract.
   * Stored and encoded as a string (e.g. `"1"`).
   */
  contractVersion: string;
  /** Monotonically increasing state version; resets to 0 when a channel is re-opened. */
  nonce: number;
  /** Token units owed to the payer (unsigned). */
  payerBalance: bigint;
  /** Token units owed to the payee (unsigned). */
  payeeBalance: bigint;
  /** Window start in milliseconds since Unix epoch. */
  windowStart: number;
  /** Window end in milliseconds since Unix epoch. */
  windowEnd: number;
}

/**
 * A channel state together with its HMAC-SHA-256 signature.
 *
 * The signature is `HMAC-SHA-256(key, encodeChannelState(state))` and is
 * represented as a lowercase hex string.
 */
export interface SignedChannelState {
  /** The raw channel state that was signed. */
  state: ChannelState;
  /**
   * HMAC-SHA-256 of the encoded state, hex-encoded.
   * Produced by `signChannelState` and verified on-chain by the contract.
   */
  signature: string;
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
