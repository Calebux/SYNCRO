import { createHash, createHmac, timingSafeEqual } from 'crypto';

export interface MeterWindow {
  channelId: string;
  contractAddress: string;
  startNonce: number;
  endNonce: number;
  startTime: number;
  endTime: number;
  payerBalance: bigint;
  payeeBalance: bigint;
}

export interface ChannelState {
  channelId: string;
  contractAddress: string;
  contractVersion: string;
  nonce: number;
  payerBalance: bigint;
  payeeBalance: bigint;
  windowStart: number;
  windowEnd: number;
}

export interface SignedChannelState {
  state: ChannelState;
  signature: string;
}

export interface StateStore {
  persist(state: SignedChannelState): Promise<void>;
  latest(channelId: string): Promise<SignedChannelState | undefined>;
}

export class InMemoryStateStore implements StateStore {
  private readonly states = new Map<string, SignedChannelState>();

  async persist(state: SignedChannelState): Promise<void> {
    const existing = this.states.get(state.state.channelId);
    if (existing && existing.state.nonce >= state.state.nonce) {
      throw new Error(
        `refusing to persist stale state: existing nonce ${existing.state.nonce} >= new nonce ${state.state.nonce}`,
      );
    }
    this.states.set(state.state.channelId, state);
  }

  async latest(channelId: string): Promise<SignedChannelState | undefined> {
    return this.states.get(channelId);
  }
}

export interface ChannelStateSigner {
  sign(payload: string): string;
}

export class HmacChannelStateSigner implements ChannelStateSigner {
  constructor(private readonly key: string) {}

  sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('hex');
  }
}

/**
 * Canonical, deterministic encoding of a channel state. The contract version and
 * contract address are bound into the payload so a state signed for one channel
 * or one contract version cannot be replayed against another.
 */
export function encodeChannelState(state: ChannelState): string {
  return [
    'v3-channel-state',
    state.contractVersion,
    state.contractAddress,
    state.channelId,
    state.nonce.toString(),
    state.payerBalance.toString(),
    state.payeeBalance.toString(),
    state.windowStart.toString(),
    state.windowEnd.toString(),
  ].join('|');
}

export function channelStateDigest(state: ChannelState): string {
  return createHash('sha256').update(encodeChannelState(state)).digest('hex');
}

/**
 * Build a channel state from a closed meter window. The window must be closed
 * (endTime >= startTime) and the resulting state must not reduce the payee's
 * balance below the previously signed state.
 */
export function constructChannelState(
  window: MeterWindow,
  contractVersion: string,
  previous?: SignedChannelState,
): ChannelState {
  if (window.endTime < window.startTime) {
    throw new Error('meter window is not closed');
  }
  if (window.endNonce < window.startNonce) {
    throw new Error('meter window nonce range is invalid');
  }
  if (window.payerBalance < 0n || window.payeeBalance < 0n) {
    throw new Error('balances must be non-negative');
  }

  const nonce = previous ? previous.state.nonce + 1 : window.endNonce;

  if (previous) {
    if (previous.state.channelId !== window.channelId) {
      throw new Error('meter window channel does not match previous state');
    }
    if (previous.state.contractAddress !== window.contractAddress) {
      throw new Error('meter window contract does not match previous state');
    }
    if (window.payeeBalance < previous.state.payeeBalance) {
      throw new Error('refusing to reduce payee balance below previously signed state');
    }
  }

  return {
    channelId: window.channelId,
    contractAddress: window.contractAddress,
    contractVersion,
    nonce,
    payerBalance: window.payerBalance,
    payeeBalance: window.payeeBalance,
    windowStart: window.startTime,
    windowEnd: window.endTime,
  };
}

/**
 * Sign a channel state with the appropriate key. The signature covers the
 * canonical encoding, which binds channel id, contract address and contract
 * version for replay protection.
 */
export function signChannelState(
  state: ChannelState,
  signer: ChannelStateSigner,
): SignedChannelState {
  const signature = signer.sign(encodeChannelState(state));
  return { state, signature };
}

export function verifyChannelState(
  signed: SignedChannelState,
  signer: ChannelStateSigner,
): boolean {
  const expected = signer.sign(encodeChannelState(signed.state));
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signed.signature, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Construct, sign and persist a state before it is sent anywhere. Persisting
 * first guarantees a crash cannot lose the newest state and leave an older one
 * authoritative.
 */
export async function produceAndPersistState(
  window: MeterWindow,
  contractVersion: string,
  signer: ChannelStateSigner,
  store: StateStore,
): Promise<SignedChannelState> {
  const previous = await store.latest(window.channelId);
  const state = constructChannelState(window, contractVersion, previous);
  const signed = signChannelState(state, signer);
  await store.persist(signed);
  return signed;
}
