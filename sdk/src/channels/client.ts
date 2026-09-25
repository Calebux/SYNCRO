/**
 * Payment-channel lifecycle helpers.
 *
 * Consumers open a channel, read its balance and burn rate, top it up, and
 * close it through these methods. The helper builds the Soroban invocation;
 * a {@link ChannelTransport} submits it. Scope checks run before any call.
 */

import { AuthError, SyncroError, ValidationError } from "../errors.js";

/** Scopes a caller may hold. Each channel operation requires exactly one. */
export const CHANNEL_SCOPE = {
  open: "channel:open",
  topUp: "channel:top_up",
  read: "channel:read",
  close: "channel:close",
  finalize: "channel:finalize",
} as const;

export type ChannelScope = (typeof CHANNEL_SCOPE)[keyof typeof CHANNEL_SCOPE];

export type ChannelOperation =
  | "open"
  | "top_up"
  | "read"
  | "initiate_close"
  | "finalize";

const SCOPE_FOR_OPERATION: Record<ChannelOperation, ChannelScope> = {
  open: CHANNEL_SCOPE.open,
  top_up: CHANNEL_SCOPE.topUp,
  read: CHANNEL_SCOPE.read,
  initiate_close: CHANNEL_SCOPE.close,
  finalize: CHANNEL_SCOPE.finalize,
};

/** How many recent balance observations are kept for the burn-rate estimate. */
const BURN_RATE_WINDOW = 8;

export type ChannelLifecycleState = "open" | "closing" | "dispute" | "closed";

/**
 * One contract call. Adapters submit `invoke` for writes and `read` for
 * `get_channel`. They must not submit a transaction for a read.
 */
export interface ChannelInvocation {
  contractId: string;
  method: "open_channel" | "top_up" | "get_channel" | "initiate_close" | "finalize";
  args: Record<string, unknown>;
  sourceAccount: string;
}

export interface ChannelTransport {
  invoke(call: ChannelInvocation): Promise<unknown>;
  read(call: ChannelInvocation): Promise<unknown>;
}

/**
 * When the depositor balance is at or below `floor`, {@link ChannelClient.ensureFunded}
 * adds `amount` so a workflow does not run the channel dry.
 */
export interface AutoTopUpConfig {
  floor: bigint;
  amount: bigint;
}

export interface ChannelClientOptions {
  contractId: string;
  /** Address that signs. This is the depositor for open and top-up. */
  caller: string;
  /** Scopes the caller's credential actually grants. */
  scopes: readonly ChannelScope[];
  transport: ChannelTransport;
  autoTopUp?: AutoTopUpConfig;
  /** Millisecond clock. Injectable so tests can advance the challenge period. */
  now?: () => number;
}

export interface OpenChannelInput {
  counterparty: string;
  token: string;
  deposit: bigint;
  /** Dispute window in seconds. Stored and reported again when the channel closes. */
  disputeWindowSeconds: bigint;
}

export interface InitiateCloseInput {
  channelId: bigint;
  balanceA: bigint;
  balanceB: bigint;
  sequence: bigint;
}

/** Decoded channel. Public fields use the names a consumer should read. */
export interface ChannelView {
  id: bigint;
  depositor: string;
  counterparty: string;
  token: string;
  /** Depositor-side balance, in atomic units. This is the balance that spends down. */
  balance: bigint;
  counterpartyBalance: bigint;
  sequence: bigint;
  state: ChannelLifecycleState;
  /**
   * Unix seconds. The contract rejects finalize while ledger time is at or
   * before this instant.
   */
  disputeDeadline: bigint;
  closingStartedAt: bigint;
}

export interface ChannelBalance {
  channelId: bigint;
  balance: bigint;
  counterpartyBalance: bigint;
  state: ChannelLifecycleState;
  /**
   * Depositor-balance decrease per second, from recent observations.
   * Null until two observations exist.
   */
  burnRatePerSecond: bigint | null;
}

/**
 * What initiate-close tells the caller about locked funds.
 * Close never releases funds; finalize does, and only after the deadline.
 */
export interface ChallengePeriod {
  /** Window configured at open, when this client opened the channel. */
  windowSeconds: bigint | null;
  /** Unix seconds. Finalize is rejected while ledger time is at or before this. */
  availableAt: bigint;
  /** Seconds until `availableAt` on the client clock. Zero once that instant has passed. */
  remainingSeconds: bigint;
  /** Close does not pay anyone out. */
  fundsAvailableImmediately: false;
  /** Plain statement of when funds can be released. */
  notice: string;
}

export interface CloseResult {
  channel: ChannelView;
  challenge: ChallengePeriod;
}

export interface EnsureFundedResult {
  channel: ChannelView;
  balance: bigint;
  toppedUp: boolean;
  /** Atomic units added by this call. Zero when the balance was above the floor. */
  amount: bigint;
}

/**
 * Thrown when the caller's configured scopes do not include the operation.
 * Raised locally, before the transport is called.
 */
export class ChannelScopeError extends AuthError {
  readonly operation: ChannelOperation;
  readonly requiredScope: ChannelScope;

  constructor(operation: ChannelOperation, requiredScope: ChannelScope) {
    super(
      `Caller scope does not permit ${operation}. Required scope "${requiredScope}".`,
    );
    this.operation = operation;
    this.requiredScope = requiredScope;
  }
}

interface BalanceSample {
  atMs: number;
  balance: bigint;
}

/**
 * Typed payment-channel client.
 *
 * A consumer can open a funded channel, watch the balance, top it up, and
 * close it without assembling Soroban arguments. Writes go through
 * {@link ChannelTransport.invoke}; balance reads go through
 * {@link ChannelTransport.read}.
 */
export class ChannelClient {
  private readonly contractId: string;
  private readonly caller: string;
  private readonly scopes: ReadonlySet<ChannelScope>;
  private readonly transport: ChannelTransport;
  private readonly autoTopUp: AutoTopUpConfig | undefined;
  private readonly now: () => number;
  private readonly disputeWindows = new Map<string, bigint>();
  private readonly samples = new Map<string, BalanceSample[]>();

  constructor(options: ChannelClientOptions) {
    if (!options.contractId || typeof options.contractId !== "string") {
      throw new ValidationError("contractId is required.");
    }
    if (!options.caller || typeof options.caller !== "string") {
      throw new ValidationError("caller is required.");
    }
    if (options.autoTopUp) {
      assertNonNegative(options.autoTopUp.floor, "autoTopUp.floor");
      assertPositive(options.autoTopUp.amount, "autoTopUp.amount");
    }

    this.contractId = options.contractId;
    this.caller = options.caller;
    this.scopes = new Set(options.scopes);
    this.transport = options.transport;
    this.autoTopUp = options.autoTopUp;
    this.now = options.now ?? (() => Date.now());
  }

  /** Open a channel funded by `deposit`. The caller is the depositor. */
  async open(input: OpenChannelInput): Promise<ChannelView> {
    this.assertScope("open");
    assertAddress(input.counterparty, "counterparty");
    assertAddress(input.token, "token");
    assertPositive(input.deposit, "deposit");
    assertNonNegative(input.disputeWindowSeconds, "disputeWindowSeconds");
    if (input.counterparty === this.caller) {
      throw new ValidationError("counterparty must be a different address from the caller.");
    }

    const rawId = await this.transport.invoke(
      this.call("open_channel", {
        depositor: this.caller,
        counterparty: input.counterparty,
        token: input.token,
        deposit_amount: input.deposit,
        dispute_window: input.disputeWindowSeconds,
      }),
    );
    const id = requireBigint(rawId, "open_channel result");
    this.disputeWindows.set(id.toString(), input.disputeWindowSeconds);
    return this.load(id);
  }

  /** Add funds to the depositor side of an open channel. */
  async topUp(channelId: bigint, amount: bigint): Promise<ChannelView> {
    this.assertScope("top_up");
    assertChannelId(channelId);
    assertPositive(amount, "amount");

    await this.transport.invoke(
      this.call("top_up", {
        channel_id: channelId,
        amount,
        depositor: this.caller,
      }),
    );
    return this.load(channelId);
  }

  /** Read the depositor balance and the burn rate estimated from prior reads. */
  async getBalance(channelId: bigint): Promise<ChannelBalance> {
    this.assertScope("read");
    assertChannelId(channelId);
    const channel = await this.load(channelId);
    return this.toBalance(channel);
  }

  /**
   * Burn rate in atomic units per second. Null until this client has observed
   * the channel balance twice.
   */
  async getBurnRate(channelId: bigint): Promise<bigint | null> {
    const balance = await this.getBalance(channelId);
    return balance.burnRatePerSecond;
  }

  /**
   * If auto top-up is configured and the depositor balance is at or below the
   * floor, add the configured amount. One top-up per call.
   */
  async ensureFunded(channelId: bigint): Promise<EnsureFundedResult> {
    if (!this.autoTopUp) {
      throw new ValidationError("Auto top-up is not configured.");
    }
    this.assertScope("read");
    this.assertScope("top_up");
    assertChannelId(channelId);

    const current = await this.load(channelId);
    if (current.balance > this.autoTopUp.floor) {
      return {
        channel: current,
        balance: current.balance,
        toppedUp: false,
        amount: 0n,
      };
    }

    const amount = this.autoTopUp.amount;
    await this.transport.invoke(
      this.call("top_up", {
        channel_id: channelId,
        amount,
        depositor: this.caller,
      }),
    );
    const channel = await this.load(channelId);
    return {
      channel,
      balance: channel.balance,
      toppedUp: true,
      amount,
    };
  }

  /**
   * Start closing. Funds stay escrowed until the challenge period ends and
   * someone calls {@link finalize}.
   */
  async initiateClose(input: InitiateCloseInput): Promise<CloseResult> {
    this.assertScope("initiate_close");
    assertChannelId(input.channelId);
    assertNonNegative(input.balanceA, "balanceA");
    assertNonNegative(input.balanceB, "balanceB");
    if (input.sequence <= 0n) {
      throw new ValidationError("sequence must be greater than zero.");
    }

    await this.transport.invoke(
      this.call("initiate_close", {
        channel_id: input.channelId,
        balance_a: input.balanceA,
        balance_b: input.balanceB,
        seq: input.sequence,
        sig: this.caller,
      }),
    );
    const channel = await this.load(input.channelId);
    return {
      channel,
      challenge: this.describeChallenge(channel),
    };
  }

  /** Release funds after the challenge period. The contract enforces the deadline. */
  async finalize(channelId: bigint, expectedSequence: bigint): Promise<ChannelView> {
    this.assertScope("finalize");
    assertChannelId(channelId);
    if (expectedSequence < 0n) {
      throw new ValidationError("expectedSequence must be zero or greater.");
    }

    await this.transport.invoke(
      this.call("finalize", {
        channel_id: channelId,
        expected_sequence: expectedSequence,
      }),
    );
    return this.load(channelId);
  }

  private assertScope(operation: ChannelOperation): void {
    const requiredScope = SCOPE_FOR_OPERATION[operation];
    if (!this.scopes.has(requiredScope)) {
      throw new ChannelScopeError(operation, requiredScope);
    }
  }

  private call(method: ChannelInvocation["method"], args: Record<string, unknown>): ChannelInvocation {
    return {
      contractId: this.contractId,
      method,
      args,
      sourceAccount: this.caller,
    };
  }

  private async load(channelId: bigint): Promise<ChannelView> {
    const raw = await this.transport.read(
      this.call("get_channel", { channel_id: channelId }),
    );
    if (raw == null) {
      throw new SyncroError(`Channel ${channelId.toString()} was not found.`);
    }
    const channel = decodeChannel(raw);
    this.observe(channel);
    return channel;
  }

  private observe(channel: ChannelView): void {
    const key = channel.id.toString();
    const sample: BalanceSample = { atMs: this.now(), balance: channel.balance };
    const existing = this.samples.get(key) ?? [];
    const last = existing[existing.length - 1];
    if (last && last.atMs === sample.atMs && last.balance === sample.balance) {
      return;
    }
    const next = [...existing, sample].slice(-BURN_RATE_WINDOW);
    this.samples.set(key, next);
  }

  private toBalance(channel: ChannelView): ChannelBalance {
    return {
      channelId: channel.id,
      balance: channel.balance,
      counterpartyBalance: channel.counterpartyBalance,
      state: channel.state,
      burnRatePerSecond: burnRate(this.samples.get(channel.id.toString()) ?? []),
    };
  }

  private describeChallenge(channel: ChannelView): ChallengePeriod {
    const availableAt = channel.disputeDeadline;
    const nowSec = BigInt(Math.floor(this.now() / 1000));
    const remainingSeconds = availableAt > nowSec ? availableAt - nowSec : 0n;
    const windowSeconds = this.disputeWindows.get(channel.id.toString()) ?? null;
    const windowText =
      windowSeconds === null ? "" : ` The challenge period is ${windowSeconds.toString()} seconds.`;

    const notice =
      remainingSeconds > 0n
        ? `Funds are not instantly available. They stay locked until the challenge period ends at unix ${availableAt.toString()} (${remainingSeconds.toString()} seconds remaining). Finalize before then is rejected.${windowText}`
        : `Funds are not instantly available from close. The challenge period ended at unix ${availableAt.toString()}; finalize can release them.${windowText}`;

    return {
      windowSeconds,
      availableAt,
      remainingSeconds,
      fundsAvailableImmediately: false,
      notice,
    };
  }
}

function burnRate(samples: readonly BalanceSample[]): bigint | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;
  const elapsedMs = last.atMs - first.atMs;
  if (elapsedMs <= 0) return null;

  let burned = 0n;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (!prev || !curr) continue;
    if (prev.balance > curr.balance) burned += prev.balance - curr.balance;
  }

  const elapsedSec = BigInt(Math.floor(elapsedMs / 1000));
  if (elapsedSec === 0n) return (burned * 1000n) / BigInt(elapsedMs);
  return burned / elapsedSec;
}

function decodeChannel(raw: unknown): ChannelView {
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError("Channel response must be an object.");
  }
  const record = raw as Record<string, unknown>;
  return {
    id: requireBigint(field(record, "id"), "id"),
    depositor: requireAddress(field(record, "depositor"), "depositor"),
    counterparty: requireAddress(field(record, "counterparty"), "counterparty"),
    token: requireAddress(field(record, "token"), "token"),
    balance: requireBigint(field(record, "balance_a"), "balance_a"),
    counterpartyBalance: requireBigint(field(record, "balance_b"), "balance_b"),
    sequence: requireBigint(field(record, "sequence"), "sequence"),
    state: parseState(field(record, "state")),
    disputeDeadline: requireBigint(field(record, "dispute_deadline"), "dispute_deadline"),
    closingStartedAt: requireBigint(field(record, "closing_started_at"), "closing_started_at"),
  };
}

function field(record: Record<string, unknown>, name: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, name)) {
    throw new ValidationError(`Channel response is missing ${name}.`);
  }
  return record[name];
}

function parseState(value: unknown): ChannelLifecycleState {
  if (typeof value === "object" && value !== null && "tag" in value) {
    return parseState((value as { tag: unknown }).tag);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    const n = Number(value);
    if (n === 1) return "open";
    if (n === 2) return "closing";
    if (n === 3) return "dispute";
    if (n === 4) return "closed";
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (
      normalized === "open" ||
      normalized === "closing" ||
      normalized === "dispute" ||
      normalized === "closed"
    ) {
      return normalized;
    }
  }
  throw new ValidationError("Channel state is not a recognized value.");
}

function requireBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^(?:0|-?[1-9]\d*)$/.test(value)) return BigInt(value);
  throw new ValidationError(`${label} must be an integer.`);
}

function requireAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${label} must be an address.`);
  }
  return value;
}

function assertAddress(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${label} is required.`);
  }
}

function assertChannelId(channelId: bigint): void {
  if (typeof channelId !== "bigint" || channelId <= 0n) {
    throw new ValidationError("channelId must be a positive integer.");
  }
}

function assertPositive(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new ValidationError(`${label} must be greater than zero.`);
  }
}

function assertNonNegative(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n) {
    throw new ValidationError(`${label} must be zero or greater.`);
  }
}
