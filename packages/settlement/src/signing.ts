import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * A closed meter window that a channel state is constructed from.
 * Balances are the cumulative amounts owed to each party for the window.
 */
export interface MeterWindow {
  /** Monotonic window sequence number, used to derive the state nonce. */
  windowId: number;
  /** Cumulative amount owed to the payer for this window. */
  payerBalance: bigint;
  /** Cumulative amount owed to the payee for this window. */
  payeeBalance: bigint;
  /** Inclusive start of the usage window covered by this state. */
  windowStart: number;
  /** Exclusive end of the usage window covered by this state. */
  windowEnd: number;
}

/**
 * The signed channel state: the core artifact that makes an off-chain call
 * enforceable on-chain. It is bound to a specific channel and contract
 * version so it cannot be replayed elsewhere.
 */
export interface ChannelState {
  /** Identifier of the channel this state belongs to. */
  channelId: string;
  /** Address of the settlement contract this state is bound to. */
  contractAddress: string;
  /** Contract version, part of the replay-protection binding. */
  contractVersion: string;
  /** Monotonic nonce; strictly increases with every signed state. */
  nonce: number;
  /** Cumulative balance owed to the payer. */
  payerBalance: bigint;
  /** Cumulative balance owed to the payee. */
  payeeBalance: bigint;
  /** Inclusive start of the usage window covered by this state. */
  windowStart: number;
  /** Exclusive end of the usage window covered by this state. */
  windowEnd: number;
}

/** A channel state together with the signature over its canonical encoding. */
export interface SignedChannelState {
  state: ChannelState;
  signature: string;
}

/**
 * Persistence boundary. Every state MUST be persisted before it is sent
 * anywhere, so a crash cannot lose the newest state and leave an older one
 * authoritative.
 */
export interface StateStore {
  /** Persist a signed state. Must resolve only once durably stored. */
  save(signed: SignedChannelState): Promise<void>;
  /** Load the most recently persisted signed state, if any. */
  loadLatest(channelId: string): Promise<SignedChannelState | undefined>;
}

/**
 * Transport boundary. Sending happens strictly after persistence.
 */
export interface StateTransport {
  send(signed: SignedChannelState): Promise<void>;
}

/**
 * Signing key abstraction. The appropriate key is the channel's signing key;
 * callers supply it explicitly so the same code works for any key backend.
 */
export interface SigningKey {
  /** Sign the canonical encoding of a state, returning a hex signature. */
  sign(payload: string): Promise<string> | string;
}

/**
 * Canonical, deterministic encoding of a channel state. Field order and
 * separators are fixed so the contract-side verifier can reproduce the exact
 * bytes. The channel id, contract address and contract version are included
 * to bind the state and prevent cross-channel / cross-version replay.
 */
export function encodeChannelState(state: ChannelState): string {
  return [
    'v3',
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

/**
 * Construct a channel state from a closed meter window. The nonce is derived
 * monotonically from the window sequence so states cannot be reordered or
 * replayed.
 */
export function constructChannelState(params: {
  channelId: string;
  contractAddress: string;
  contractVersion: string;
  window: MeterWindow;
}): ChannelState {
  const { channelId, contractAddress, contractVersion, window } = params;
  if (window.windowEnd <= window.windowStart) {
    throw new Error('meter window must be closed (windowEnd > windowStart)');
  }
  return {
    channelId,
    contractAddress,
    contractVersion,
    nonce: window.windowId,
    payerBalance: window.payerBalance,
    payeeBalance: window.payeeBalance,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
  };
}

/**
 * Sign a channel state with the appropriate key. The signature covers the
 * canonical encoding, so it is bound to the channel and contract version.
 */
export async function signChannelState(
  state: ChannelState,
  key: SigningKey,
): Promise<SignedChannelState> {
  const signature = await key.sign(encodeChannelState(state));
  return { state, signature };
}

/**
 * Verify a signature over a channel state using the same key abstraction.
 * Used to round-trip states through the contract's verification.
 */
export async function verifyChannelState(
  signed: SignedChannelState,
  key: SigningKey,
): Promise<boolean> {
  const expected = await key.sign(encodeChannelState(signed.state));
  const a = Buffer.from(expected);
  const b = Buffer.from(signed.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Guard: never construct a state that reduces the payee's balance below a
 * previously signed state.
 */
export function assertNonDecreasingPayee(
  next: ChannelState,
  previous: SignedChannelState | undefined,
): void {
  if (!previous) return;
  if (next.nonce <= previous.state.nonce) {
    throw new Error('channel state nonce must strictly increase');
  }
  if (next.payeeBalance < previous.state.payeeBalance) {
    throw new Error('channel state must not reduce the payee balance');
  }
}

/**
 * Construct, guard, sign and persist a channel state before it is sent
 * anywhere. Persist-before-send ordering is enforced here: the store is
 * awaited before the transport is invoked.
 */
export async function produceAndPersistState(params: {
  channelId: string;
  contractAddress: string;
  contractVersion: string;
  window: MeterWindow;
  key: SigningKey;
  store: StateStore;
  transport?: StateTransport;
}): Promise<SignedChannelState> {
  const { key, store, transport } = params;
  const previous = await store.loadLatest(params.channelId);
  const state = constructChannelState({
    channelId: params.channelId,
    contractAddress: params.contractAddress,
    contractVersion: params.contractVersion,
    window: params.window,
  });
  assertNonDecreasingPayee(state, previous);
  const signed = await signChannelState(state, key);
  // Persist before send: a crash here must not lose the newest state.
  await store.save(signed);
  if (transport) {
    await transport.send(signed);
  }
  return signed;
}

/**
 * Deterministic digest of a channel state, useful for logging and for
 * matching the contract-side replay-protection identifier.
 */
export function channelStateDigest(state: ChannelState): string {
  return createHash('sha256').update(encodeChannelState(state)).digest('hex');
}

/**
 * HMAC-based signing key helper for environments that sign with a shared
 * secret. The secret is supplied by the caller; no secret is embedded here.
 */
export function hmacSigningKey(secret: string): SigningKey {
  return {
    sign(payload: string): string {
      return createHmac('sha256', secret).update(payload).digest('hex');
    },
  };
}
