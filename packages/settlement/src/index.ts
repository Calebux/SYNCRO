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

/**
 * Measured per-operation costs from the gas-budget issue. These are the
 * on-chain costs (in wei) of the operations a submission performs, used to
 * derive the default batching threshold instead of picking a round number.
 */
export interface GasCostModel {
  /** Cost of a single off-chain metered operation, in wei. */
  perOperationCost: bigint;
  /** Fixed cost of submitting a batch to the chain, in wei. */
  submissionBaseCost: bigint;
  /** Marginal cost per operation included in a submission, in wei. */
  submissionPerOperationCost: bigint;
}

/**
 * Measured costs from the gas-budget issue. Submitting a batch costs
 * `submissionBaseCost` plus `submissionPerOperationCost` per operation, so the
 * break-even point is where the value accumulated since the last submission
 * covers the fixed submission cost. We require the accumulated value to cover
 * the fixed cost with a safety multiple so a submission is never a net loss.
 */
export const MEASURED_GAS_COSTS: GasCostModel = {
  perOperationCost: 21_000n,
  submissionBaseCost: 210_000n,
  submissionPerOperationCost: 21_000n,
};

/** Safety multiple applied to the fixed submission cost when deriving the default threshold. */
export const DEFAULT_THRESHOLD_SAFETY_MULTIPLE = 10n;

/**
 * Derive the default accumulated-value threshold from measured costs. The
 * threshold is the fixed submission cost times a safety multiple, so a
 * submission is only triggered once the accumulated value comfortably covers
 * the cost of touching the chain.
 */
export function deriveDefaultValueThreshold(costs: GasCostModel = MEASURED_GAS_COSTS): bigint {
  return costs.submissionBaseCost * DEFAULT_THRESHOLD_SAFETY_MULTIPLE;
}

/**
 * Per-channel batching policy. A high-volume channel and a small channel want
 * different policies, so every threshold is configurable per channel.
 */
export interface BatchingPolicy {
  /** Accumulated unsettled value (wei) that triggers a submission. */
  valueThreshold: bigint;
  /** Maximum time (ms) between submissions, regardless of accumulated value. */
  maxIntervalMs: number;
  /** Fraction of the channel cap at which an approaching-cap submission is forced (0..1). */
  capApproachRatio: number;
  /** Maximum unsettled value (wei) tolerated before a submission is forced. */
  exposureCeiling: bigint;
}

/**
 * Default policy derived from measured costs. The value threshold traces to
 * `deriveDefaultValueThreshold`; the exposure ceiling is set to the same
 * measured-cost-derived value so exposure never exceeds what a submission can
 * economically clear.
 */
export function defaultBatchingPolicy(costs: GasCostModel = MEASURED_GAS_COSTS): BatchingPolicy {
  const valueThreshold = deriveDefaultValueThreshold(costs);
  return {
    valueThreshold,
    maxIntervalMs: 60 * 60 * 1000,
    capApproachRatio: 0.9,
    exposureCeiling: valueThreshold,
  };
}

/**
 * Per-channel policy registry. Thresholds are configurable per channel so a
 * high-volume channel and a small one can use different policies.
 */
export class BatchingPolicyRegistry {
  private readonly policies = new Map<string, BatchingPolicy>();

  constructor(private readonly fallback: BatchingPolicy = defaultBatchingPolicy()) {}

  set(channelId: string, policy: BatchingPolicy): void {
    this.policies.set(channelId, policy);
  }

  get(channelId: string): BatchingPolicy {
    return this.policies.get(channelId) ?? this.fallback;
  }
}

/** Inputs describing the current unsettled state of a channel. */
export interface BatchingContext {
  channelId: string;
  /** Value accumulated since the last submission, in wei. */
  accumulatedValue: bigint;
  /** Time since the last submission, in ms. */
  elapsedMs: number;
  /** Current channel cap, in wei. */
  channelCap: bigint;
  /** Value already committed on-chain for the channel, in wei. */
  committedValue: bigint;
  /** Whether the channel is approaching exhaustion. */
  channelExhausted?: boolean;
  /** Operator-forced flush. */
  forceFlush?: boolean;
}

export type SubmissionTrigger =
  | 'value-threshold'
  | 'max-interval'
  | 'cap-approach'
  | 'channel-exhaustion'
  | 'exposure-ceiling'
  | 'operator-forced';

export interface SubmissionDecision {
  submit: boolean;
  triggers: SubmissionTrigger[];
}

/**
 * Decide whether to touch the chain for a channel. A submission is triggered by
 * any of: an accumulated-value threshold, a maximum interval, an approaching
 * cap or channel exhaustion, an operator-forced flush, or the exposure ceiling
 * being reached. The exposure ceiling always forces a submission so unsettled
 * value never exceeds the configured ceiling.
 */
export function shouldSubmit(
  context: BatchingContext,
  policy: BatchingPolicy,
): SubmissionDecision {
  const triggers: SubmissionTrigger[] = [];

  if (context.forceFlush) {
    triggers.push('operator-forced');
  }
  if (context.accumulatedValue >= policy.valueThreshold) {
    triggers.push('value-threshold');
  }
  if (context.elapsedMs >= policy.maxIntervalMs) {
    triggers.push('max-interval');
  }
  if (context.channelExhausted) {
    triggers.push('channel-exhaustion');
  }
  if (
    context.channelCap > 0n &&
    context.committedValue + context.accumulatedValue >=
      (context.channelCap * BigInt(Math.round(policy.capApproachRatio * 100))) / 100n
  ) {
    triggers.push('cap-approach');
  }
  if (context.accumulatedValue >= policy.exposureCeiling) {
    triggers.push('exposure-ceiling');
  }

  return { submit: triggers.length > 0, triggers };
}
