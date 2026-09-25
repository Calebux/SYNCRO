import { createHash, randomBytes } from 'crypto';
import { sign, verify, type KeyObject } from 'crypto';

/**
 * A closed meter window that a channel state covers.
 * `start` is inclusive, `end` is exclusive.
 */
export interface UsageWindow {
  start: number;
  end: number;
}

/**
 * The signed channel state. This is the core artifact of the settlement
 * system: it is what makes an off-chain call enforceable on-chain.
 *
 * The state is bound to a specific channel and contract version so that it
 * cannot be replayed against another channel or an incompatible contract.
 */
export interface ChannelState {
  /** Identifier of the channel this state belongs to. */
  channelId: string;
  /** Address of the settlement contract this state is bound to. */
  contractAddress: string;
  /** Version of the settlement contract this state is bound to. */
  contractVersion: number;
  /** Monotonic nonce; strictly greater than any previously signed state. */
  nonce: number;
  /** Balance owed to the payer. */
  payerBalance: bigint;
  /** Balance owed to the payee. */
  payeeBalance: bigint;
  /** The usage window this state covers. */
  window: UsageWindow;
}

/** A channel state together with its signature. */
export interface SignedChannelState {
  state: ChannelState;
  signature: string;
}

/**
 * A closed meter window as produced by the metering layer. Balances are the
 * cumulative amounts owed at the close of the window.
 */
export interface ClosedMeterWindow {
  channelId: string;
  contractAddress: string;
  contractVersion: number;
  nonce: number;
  payerBalance: bigint;
  payeeBalance: bigint;
  window: UsageWindow;
}

/**
 * Persistence hook. Every state MUST be persisted before it is sent anywhere,
 * so a crash cannot lose the newest state and leave an older one authoritative.
 */
export interface ChannelStateStore {
  /**
   * Persist a signed state. Implementations must durably write the state
   * before returning. Must reject a state whose nonce is not greater than the
   * last persisted nonce for the channel.
   */
  persist(signed: SignedChannelState): Promise<void>;
  /** Return the last persisted signed state for a channel, if any. */
  latest(channelId: string): Promise<SignedChannelState | undefined>;
}

export class ChannelStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelStateError';
  }
}

/**
 * Deterministic encoding of a channel state used for signing and for the
 * contract-side replay protection. The encoding binds the state to the
 * channel id, contract address and contract version.
 */
export function encodeChannelState(state: ChannelState): Buffer {
  const payload = [
    'channel-state',
    'v1',
    state.channelId,
    state.contractAddress,
    String(state.contractVersion),
    String(state.nonce),
    state.payerBalance.toString(),
    state.payeeBalance.toString(),
    String(state.window.start),
    String(state.window.end),
  ].join('|');
  return Buffer.from(payload, 'utf8');
}

/** Hash of the encoded state; this is what is signed. */
export function hashChannelState(state: ChannelState): Buffer {
  return createHash('sha256').update(encodeChannelState(state)).digest();
}

/**
 * Construct a channel state from a closed meter window.
 *
 * If `previous` is provided, the new state must not reduce the payee's
 * balance below the previously signed state, and the nonce must increase.
 */
export function constructChannelState(
  window: ClosedMeterWindow,
  previous?: SignedChannelState,
): ChannelState {
  if (window.window.end <= window.window.start) {
    throw new ChannelStateError('usage window must be non-empty');
  }
  if (window.payerBalance < 0n || window.payeeBalance < 0n) {
    throw new ChannelStateError('balances must be non-negative');
  }

  if (previous) {
    const prev = previous.state;
    if (prev.channelId !== window.channelId) {
      throw new ChannelStateError('channel id mismatch with previous state');
    }
    if (prev.contractAddress !== window.contractAddress) {
      throw new ChannelStateError('contract address mismatch with previous state');
    }
    if (prev.contractVersion !== window.contractVersion) {
      throw new ChannelStateError('contract version mismatch with previous state');
    }
    if (window.nonce <= prev.nonce) {
      throw new ChannelStateError('nonce must be strictly monotonic');
    }
    if (window.payeeBalance < prev.payeeBalance) {
      throw new ChannelStateError(
        'new state must not reduce the payee balance below the previously signed state',
      );
    }
  }

  return {
    channelId: window.channelId,
    contractAddress: window.contractAddress,
    contractVersion: window.contractVersion,
    nonce: window.nonce,
    payerBalance: window.payerBalance,
    payeeBalance: window.payeeBalance,
    window: { start: window.window.start, end: window.window.end },
  };
}

/** Sign a channel state with the given key. */
export function signChannelState(
  state: ChannelState,
  key: KeyObject,
): SignedChannelState {
  const signature = sign(null, hashChannelState(state), key).toString('base64');
  return { state, signature };
}

/** Verify a signed channel state against the given public key. */
export function verifyChannelState(
  signed: SignedChannelState,
  key: KeyObject,
): boolean {
  try {
    return verify(
      null,
      hashChannelState(signed.state),
      key,
      Buffer.from(signed.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/**
 * Construct, sign and persist a channel state from a closed meter window.
 *
 * The state is persisted before it is returned, enforcing the
 * persist-before-send ordering: a crash after this call cannot lose the
 * newest state and leave an older one authoritative.
 */
export async function produceChannelState(
  window: ClosedMeterWindow,
  key: KeyObject,
  store: ChannelStateStore,
): Promise<SignedChannelState> {
  const previous = await store.latest(window.channelId);
  const state = constructChannelState(window, previous);
  const signed = signChannelState(state, key);
  await store.persist(signed);
  return signed;
}

/** Generate a random channel id. */
export function newChannelId(): string {
  return randomBytes(16).toString('hex');
}
