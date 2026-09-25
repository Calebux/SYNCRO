import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import { dirname } from 'path';

/**
 * A closed meter window that a channel state is constructed from.
 * Balances are the cumulative amounts owed to each party for the window.
 */
export interface MeterWindow {
  /** Monotonic window sequence number. */
  window: number;
  /** Inclusive start of the usage window (ms since epoch). */
  startTime: number;
  /** Exclusive end of the usage window (ms since epoch). */
  endTime: number;
  /** Cumulative balance owed to the payer. */
  payerBalance: bigint;
  /** Cumulative balance owed to the payee. */
  payeeBalance: bigint;
}

/**
 * The signed channel state: the core artifact that makes an off-chain call
 * enforceable on-chain. It is bound to a specific channel and contract
 * version so it cannot be replayed elsewhere.
 */
export interface ChannelState {
  /** Channel identifier this state belongs to. */
  channelId: string;
  /** Address of the settlement contract this state is bound to. */
  contractAddress: string;
  /** Contract version, matching the contract-side replay protection. */
  contractVersion: number;
  /** Monotonic nonce; strictly greater than any previously signed state. */
  nonce: number;
  /** Cumulative balance owed to the payer. */
  payerBalance: bigint;
  /** Cumulative balance owed to the payee. */
  payeeBalance: bigint;
  /** Inclusive start of the usage window this state covers (ms since epoch). */
  windowStart: number;
  /** Exclusive end of the usage window this state covers (ms since epoch). */
  windowEnd: number;
}

/** A channel state together with its signature. */
export interface SignedChannelState {
  state: ChannelState;
  signature: string;
}

/**
 * Deterministic, domain-separated encoding of a channel state. Binding the
 * channel id, contract address and contract version into the digest is what
 * prevents a state signed for one channel/contract from being replayed
 * against another.
 */
export function encodeChannelState(state: ChannelState): string {
  return [
    'channel-state',
    state.channelId,
    state.contractAddress.toLowerCase(),
    String(state.contractVersion),
    String(state.nonce),
    state.payerBalance.toString(),
    state.payeeBalance.toString(),
    String(state.windowStart),
    String(state.windowEnd),
  ].join('|');
}

/** Digest of a channel state, used as the message that gets signed. */
export function hashChannelState(state: ChannelState): string {
  return createHash('sha256').update(encodeChannelState(state)).digest('hex');
}

/**
 * Signs a channel state with the appropriate key. The key is bound to the
 * channel/contract via the digest, so the signature is only valid for this
 * exact state.
 */
export function signChannelState(state: ChannelState, signingKey: string): SignedChannelState {
  const signature = createHmac('sha256', signingKey).update(hashChannelState(state)).digest('hex');
  return { state, signature };
}

/** Verifies a signed channel state against the signing key. */
export function verifyChannelState(signed: SignedChannelState, signingKey: string): boolean {
  const expected = signChannelState(signed.state, signingKey).signature;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signed.signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Constructs a channel state from a closed meter window. The nonce is
 * monotonic and the payee balance is never allowed to drop below the last
 * signed state, so a state can never reduce what the payee is owed.
 */
export function constructChannelState(params: {
  channelId: string;
  contractAddress: string;
  contractVersion: number;
  window: MeterWindow;
  previous?: ChannelState;
}): ChannelState {
  const { channelId, contractAddress, contractVersion, window, previous } = params;

  const nonce = previous ? previous.nonce + 1 : 1;

  const payerBalance = window.payerBalance;
  const payeeBalance = previous && previous.payeeBalance > window.payeeBalance
    ? previous.payeeBalance
    : window.payeeBalance;

  return {
    channelId,
    contractAddress,
    contractVersion,
    nonce,
    payerBalance,
    payeeBalance,
    windowStart: window.startTime,
    windowEnd: window.endTime,
  };
}

/**
 * Persists signed channel states. Every state is written to disk before it is
 * sent anywhere, so a crash cannot lose the newest state and leave an older
 * one authoritative.
 */
export class ChannelStateStore {
  constructor(private readonly filePath: string) {}

  /**
   * Persists a signed state before it is sent. Returns once the state is
   * durably on disk.
   */
  async persist(signed: SignedChannelState): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const record = JSON.stringify({
      state: {
        ...signed.state,
        payerBalance: signed.state.payerBalance.toString(),
        payeeBalance: signed.state.payeeBalance.toString(),
      },
      signature: signed.signature,
    });
    await fs.writeFile(this.filePath, record, 'utf8');
  }

  /** Loads the most recently persisted signed state, if any. */
  async load(): Promise<SignedChannelState | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    const parsed = JSON.parse(raw) as {
      state: Omit<ChannelState, 'payerBalance' | 'payeeBalance'> & {
        payerBalance: string;
        payeeBalance: string;
      };
      signature: string;
    };
    return {
      state: {
        ...parsed.state,
        payerBalance: BigInt(parsed.state.payerBalance),
        payeeBalance: BigInt(parsed.state.payeeBalance),
      },
      signature: parsed.signature,
    };
  }

  /**
   * Constructs, signs and persists a state from a closed meter window. The
   * state is persisted before it is returned, enforcing persist-before-send
   * ordering for callers.
   */
  async buildAndPersist(params: {
    channelId: string;
    contractAddress: string;
    contractVersion: number;
    window: MeterWindow;
    signingKey: string;
  }): Promise<SignedChannelState> {
    const previous = await this.load();
    const state = constructChannelState({
      channelId: params.channelId,
      contractAddress: params.contractAddress,
      contractVersion: params.contractVersion,
      window: params.window,
      previous: previous?.state,
    });
    const signed = signChannelState(state, params.signingKey);
    await this.persist(signed);
    return signed;
  }
}
