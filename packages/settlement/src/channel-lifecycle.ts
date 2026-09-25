/**
 * Channel lifecycle manager (issue #1456).
 *
 * Channels are infrastructure that must exist before a call can be paid for.
 * This manager makes channel mechanics invisible to the payer:
 *
 *  - opens a channel on demand the first time a principal pays a provider,
 *  - monitors remaining balance and projects time-to-exhaustion from the
 *    recent burn rate,
 *  - triggers `top_up` before exhaustion (subject to the principal's
 *    authorization) rather than after a rejection,
 *  - never leaves a half-opened channel that the database believes is usable,
 *  - exposes channel state so the gateway can reject early when a channel is
 *    exhausted.
 */

/** Default initial deposit for a freshly opened channel. */
export const DEFAULT_INITIAL_DEPOSIT = 1_000_000n;

/** Default top-up amount applied when a channel nears exhaustion. */
export const DEFAULT_TOP_UP_AMOUNT = 1_000_000n;

/**
 * Fraction of the channel balance at which we proactively top up. When the
 * projected time-to-exhaustion drops below this fraction of the monitoring
 * window we top up before the channel is actually drained.
 */
export const TOP_UP_THRESHOLD = 0.25;

/** Number of recent samples used to compute the burn rate. */
export const BURN_RATE_WINDOW = 8;

/**
 * Lifecycle states a channel can be in. `opening` is deliberately distinct
 * from `open`: a channel that is mid-flight must never be treated as usable.
 */
export type ChannelState =
  | "opening"
  | "open"
  | "topping_up"
  | "exhausted"
  | "closed"
  | "failed";

/** A single observed spend sample, used to project the burn rate. */
export interface BurnSample {
  /** Monotonic timestamp (ms) at which the sample was taken. */
  at: number;
  /** Cumulative amount spent on the channel at that time. */
  spent: bigint;
}

/** Channel record as persisted by the settlement store. */
export interface ChannelRecord {
  channelId: string;
  principal: string;
  provider: string;
  deposit: bigint;
  spent: bigint;
  state: ChannelState;
  openedAt: number;
  updatedAt: number;
}

/**
 * Minimal persistence surface the lifecycle manager needs. Implementations
 * live in the settlement store; keeping it abstract lets the manager stay
 * testable and free of storage details.
 */
export interface ChannelStore {
  get(principal: string, provider: string): Promise<ChannelRecord | undefined>;
  /**
   * Persist a channel. Implementations MUST treat `state: "opening"` as
   * non-usable so a half-opened channel can never be admitted.
   */
  put(record: ChannelRecord): Promise<void>;
  delete(channelId: string): Promise<void>;
}

/** On-chain / settlement operations the manager drives. */
export interface ChannelChain {
  /** Open a channel and return its id. May throw if the open fails mid-flight. */
  open(params: {
    principal: string;
    provider: string;
    deposit: bigint;
  }): Promise<{ channelId: string }>;
  /** Add funds to an existing channel. */
  topUp(params: { channelId: string; amount: bigint }): Promise<void>;
}

/**
 * Authorization check for spending the principal's funds. Top-ups are only
 * performed when the principal has authorized them.
 */
export interface PrincipalAuthorization {
  canTopUp(params: {
    principal: string;
    provider: string;
    amount: bigint;
  }): Promise<boolean>;
}

/** Channel state exposed to the gateway for early admission decisions. */
export interface ChannelAdmission {
  usable: boolean;
  state: ChannelState;
  remaining: bigint;
  /** Projected ms until exhaustion, or `null` when the burn rate is zero. */
  timeToExhaustionMs: number | null;
}

export interface ChannelLifecycleOptions {
  store: ChannelStore;
  chain: ChannelChain;
  authorization: PrincipalAuthorization;
  initialDeposit?: bigint;
  topUpAmount?: bigint;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * Manages the full lifecycle of payment channels: on-demand open, balance
 * monitoring, proactive top-up, and gateway-facing state.
 */
export class ChannelLifecycleManager {
  private readonly store: ChannelStore;
  private readonly chain: ChannelChain;
  private readonly authorization: PrincipalAuthorization;
  private readonly initialDeposit: bigint;
  private readonly topUpAmount: bigint;
  private readonly now: () => number;
  private readonly samples = new Map<string, BurnSample[]>();

  constructor(options: ChannelLifecycleOptions) {
    this.store = options.store;
    this.chain = options.chain;
    this.authorization = options.authorization;
    this.initialDeposit = options.initialDeposit ?? DEFAULT_INITIAL_DEPOSIT;
    this.topUpAmount = options.topUpAmount ?? DEFAULT_TOP_UP_AMOUNT;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Ensure a usable channel exists for `principal -> provider`, opening one on
   * demand with a sensible initial deposit. Returns the channel record.
   *
   * If the open fails mid-flight the channel is removed so the database never
   * believes a half-opened channel is usable.
   */
  async ensureChannel(
    principal: string,
    provider: string,
  ): Promise<ChannelRecord> {
    const existing = await this.store.get(principal, provider);
    if (existing && existing.state === "open") {
      return existing;
    }

    const at = this.now();
    const opening: ChannelRecord = {
      channelId: `pending:${principal}:${provider}`,
      principal,
      provider,
      deposit: this.initialDeposit,
      spent: 0n,
      state: "opening",
      openedAt: at,
      updatedAt: at,
    };
    // Persist the in-flight state first so a crash mid-open is observable and
    // never mistaken for a usable channel.
    await this.store.put(opening);

    try {
      const { channelId } = await this.chain.open({
        principal,
        provider,
        deposit: this.initialDeposit,
      });
      const opened: ChannelRecord = {
        ...opening,
        channelId,
        state: "open",
        updatedAt: this.now(),
      };
      await this.store.put(opened);
      this.samples.set(channelId, [{ at: opened.updatedAt, spent: 0n }]);
      return opened;
    } catch (err) {
      // Roll back the half-opened channel so it can never be admitted.
      await this.store.delete(opening.channelId);
      throw err;
    }
  }

  /**
   * Record spend against a channel and, if it is nearing exhaustion, top it up
   * before the next request would be rejected.
   */
  async recordSpend(
    principal: string,
    provider: string,
    amount: bigint,
  ): Promise<ChannelRecord> {
    const channel = await this.ensureChannel(principal, provider);
    const spent = channel.spent + amount;
    const updated: ChannelRecord = {
      ...channel,
      spent,
      state: spent >= channel.deposit ? "exhausted" : "open",
      updatedAt: this.now(),
    };
    await this.store.put(updated);
    this.recordSample(updated);

    if (this.shouldTopUp(updated)) {
      return this.topUp(principal, provider);
    }
    return updated;
  }

  /**
   * Top up a channel subject to the principal's authorization. Returns the
   * updated record; if unauthorized or already healthy, returns it unchanged.
   */
  async topUp(principal: string, provider: string): Promise<ChannelRecord> {
    const channel = await this.store.get(principal, provider);
    if (!channel || channel.state === "closed" || channel.state === "failed") {
      throw new Error(
        `cannot top up channel for ${principal} -> ${provider}: not open`,
      );
    }

    const authorized = await this.authorization.canTopUp({
      principal,
      provider,
      amount: this.topUpAmount,
    });
    if (!authorized) {
      return channel;
    }

    const toppingUp: ChannelRecord = {
      ...channel,
      state: "topping_up",
      updatedAt: this.now(),
    };
    await this.store.put(toppingUp);

    try {
      await this.chain.topUp({
        channelId: channel.channelId,
        amount: this.topUpAmount,
      });
      const toppedUp: ChannelRecord = {
        ...toppingUp,
        deposit: channel.deposit + this.topUpAmount,
        state: "open",
        updatedAt: this.now(),
      };
      await this.store.put(toppedUp);
      return toppedUp;
    } catch (err) {
      // Restore the pre-top-up state so the channel stays consistent.
      await this.store.put(channel);
      throw err;
    }
  }

  /**
   * Channel state for the gateway so admission can reject early when a channel
   * is exhausted or not yet usable.
   */
  async admission(
    principal: string,
    provider: string,
  ): Promise<ChannelAdmission> {
    const channel = await this.store.get(principal, provider);
    if (!channel) {
      return {
        usable: false,
        state: "closed",
        remaining: 0n,
        timeToExhaustionMs: null,
      };
    }
    const remaining = channel.deposit - channel.spent;
    return {
      usable: channel.state === "open" && remaining > 0n,
      state: channel.state,
      remaining: remaining > 0n ? remaining : 0n,
      timeToExhaustionMs: this.projectTimeToExhaustion(channel),
    };
  }

  /**
   * Project ms until the channel is exhausted from the recent burn rate.
   * Returns `null` when there is no measurable burn.
   */
  projectTimeToExhaustion(channel: ChannelRecord): number | null {
    const samples = this.samples.get(channel.channelId);
    if (!samples || samples.length < 2) {
      return null;
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = last.at - first.at;
    const burned = last.spent - first.spent;
    if (elapsed <= 0 || burned <= 0n) {
      return null;
    }
    const remaining = channel.deposit - channel.spent;
    if (remaining <= 0n) {
      return 0;
    }
    // burn rate = burned / elapsed (amount per ms); time = remaining / rate.
    const ratePerMs = Number(burned) / elapsed;
    return Math.floor(Number(remaining) / ratePerMs);
  }

  private shouldTopUp(channel: ChannelRecord): boolean {
    if (channel.state !== "open") {
      return false;
    }
    const remaining = channel.deposit - channel.spent;
    if (remaining <= 0n) {
      return true;
    }
    const projected = this.projectTimeToExhaustion(channel);
    if (projected === null) {
      // No burn signal yet: fall back to a simple balance fraction.
      return Number(remaining) / Number(channel.deposit) <= TOP_UP_THRESHOLD;
    }
    const window = this.monitoringWindowMs(channel);
    return projected <= window * TOP_UP_THRESHOLD;
  }

  private monitoringWindowMs(channel: ChannelRecord): number {
    const samples = this.samples.get(channel.channelId);
    if (!samples || samples.length < 2) {
      return 0;
    }
    return samples[samples.length - 1].at - samples[0].at;
  }

  private recordSample(channel: ChannelRecord): void {
    const samples = this.samples.get(channel.channelId) ?? [];
    samples.push({ at: channel.updatedAt, spent: channel.spent });
    while (samples.length > BURN_RATE_WINDOW) {
      samples.shift();
    }
    this.samples.set(channel.channelId, samples);
  }
}
