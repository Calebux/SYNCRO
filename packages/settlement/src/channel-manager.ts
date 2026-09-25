/**
 * Channel lifecycle manager.
 *
 * Channels are infrastructure that must exist before a call can be paid for.
 * This manager makes channel mechanics invisible to the payer:
 *
 *  - opens a channel on demand the first time a principal pays a provider,
 *  - monitors the remaining balance and projects time-to-exhaustion from the
 *    recent burn rate,
 *  - triggers `top_up` before exhaustion (subject to the principal's
 *    authorization) rather than after a rejection,
 *  - never leaves a half-opened channel that the database believes is usable,
 *  - exposes channel state so the gateway can reject early when a channel is
 *    exhausted.
 */

/** Default initial deposit for a freshly opened channel (in atomic units). */
export const DEFAULT_INITIAL_DEPOSIT = 1_000_000n;

/** Default top-up amount applied when a channel nears exhaustion. */
export const DEFAULT_TOP_UP_AMOUNT = 1_000_000n;

/**
 * Fraction of the channel balance at which we proactively top up. When the
 * projected time-to-exhaustion drops below the safety window we act.
 */
export const DEFAULT_TOP_UP_THRESHOLD = 0.2;

/** Safety window (ms) before projected exhaustion at which we top up. */
export const DEFAULT_SAFETY_WINDOW_MS = 30_000;

/** Number of recent samples used to estimate the burn rate. */
export const DEFAULT_BURN_WINDOW = 8;

export type ChannelStatus =
  | "opening"
  | "open"
  | "topping_up"
  | "exhausted"
  | "closed"
  | "failed";

export interface ChannelState {
  /** Stable key identifying the (principal, provider) pair. */
  readonly key: string;
  readonly principal: string;
  readonly provider: string;
  /** On-chain channel id, only set once the open has fully committed. */
  readonly channelId?: string;
  status: ChannelStatus;
  /** Remaining balance in atomic units. */
  balance: bigint;
  /** Estimated burn rate in atomic units per millisecond. */
  burnRate: number;
  /** Epoch ms of the last balance observation. */
  lastUpdated: number;
  /** Epoch ms at which the channel is projected to be exhausted. */
  projectedExhaustion?: number;
}

/**
 * Minimal settlement backend the manager drives. Implementations talk to the
 * chain / settlement engine; the manager only orchestrates lifecycle.
 */
export interface ChannelBackend {
  /** Open a channel and return its committed id. Must be atomic. */
  openChannel(params: {
    principal: string;
    provider: string;
    deposit: bigint;
  }): Promise<{ channelId: string; balance: bigint }>;
  /** Add funds to an existing channel. */
  topUp(params: {
    channelId: string;
    amount: bigint;
  }): Promise<{ balance: bigint }>;
  /** Read the current remaining balance for a channel. */
  getBalance(params: { channelId: string }): Promise<bigint>;
  /** Close a channel, releasing remaining funds. */
  closeChannel(params: { channelId: string }): Promise<void>;
}

/**
 * Persistence for channel state. The manager only marks a channel usable in
 * the store after the backend open has fully committed.
 */
export interface ChannelStore {
  get(key: string): Promise<ChannelState | undefined>;
  put(state: ChannelState): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Authorization hook. The principal must authorize any spend (initial deposit
 * or top-up) before the manager commits it.
 */
export interface PrincipalAuthorizer {
  authorize(params: {
    principal: string;
    provider: string;
    amount: bigint;
    reason: "open" | "top_up";
  }): Promise<boolean>;
}

export interface ChannelManagerOptions {
  backend: ChannelBackend;
  store: ChannelStore;
  authorizer: PrincipalAuthorizer;
  initialDeposit?: bigint;
  topUpAmount?: bigint;
  topUpThreshold?: number;
  safetyWindowMs?: number;
  burnWindow?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/** Error raised when a channel cannot be opened or topped up. */
export class ChannelError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ChannelError";
  }
}

/**
 * Manages the full lifecycle of payment channels for (principal, provider)
 * pairs. A single instance is safe to share across concurrent calls; per-key
 * work is serialized so a first paid call cannot race into two opens.
 */
export class ChannelManager {
  private readonly backend: ChannelBackend;
  private readonly store: ChannelStore;
  private readonly authorizer: PrincipalAuthorizer;
  private readonly initialDeposit: bigint;
  private readonly topUpAmount: bigint;
  private readonly topUpThreshold: number;
  private readonly safetyWindowMs: number;
  private readonly burnWindow: number;
  private readonly now: () => number;

  /** In-flight per-key operations, used to serialize lifecycle work. */
  private readonly inflight = new Map<string, Promise<ChannelState>>();

  constructor(options: ChannelManagerOptions) {
    this.backend = options.backend;
    this.store = options.store;
    this.authorizer = options.authorizer;
    this.initialDeposit = options.initialDeposit ?? DEFAULT_INITIAL_DEPOSIT;
    this.topUpAmount = options.topUpAmount ?? DEFAULT_TOP_UP_AMOUNT;
    this.topUpThreshold = options.topUpThreshold ?? DEFAULT_TOP_UP_THRESHOLD;
    this.safetyWindowMs = options.safetyWindowMs ?? DEFAULT_SAFETY_WINDOW_MS;
    this.burnWindow = options.burnWindow ?? DEFAULT_BURN_WINDOW;
    this.now = options.now ?? (() => Date.now());
  }

  static key(principal: string, provider: string): string {
    return `${principal}::${provider}`;
  }

  /**
   * Ensure a usable channel exists for the pair, opening one on demand. This
   * is the entry point a payer hits before their first paid call.
   */
  async ensureChannel(principal: string, provider: string): Promise<ChannelState> {
    const key = ChannelManager.key(principal, provider);
    const existing = await this.store.get(key);
    if (existing && this.isUsable(existing)) {
      return existing;
    }
    return this.serialize(key, () => this.openChannel(principal, provider));
  }

  /**
   * Record a spend against a channel and, if the projected time-to-exhaustion
   * falls inside the safety window, top the channel up before it runs dry.
   */
  async recordSpend(
    principal: string,
    provider: string,
    amount: bigint,
  ): Promise<ChannelState> {
    const key = ChannelManager.key(principal, provider);
    return this.serialize(key, async () => {
      const state = await this.store.get(key);
      if (!state || !state.channelId) {
        throw new ChannelError(`no usable channel for ${key}`);
      }
      const now = this.now();
      const elapsed = Math.max(1, now - state.lastUpdated);
      const spent = Number(amount);
      const observedRate = spent / elapsed;
      state.burnRate = this.ewma(state.burnRate, observedRate);
      state.balance = state.balance > amount ? state.balance - amount : 0n;
      state.lastUpdated = now;
      state.projectedExhaustion = this.projectExhaustion(state, now);
      if (state.balance === 0n) {
        state.status = "exhausted";
      }
      await this.store.put(state);

      if (this.shouldTopUp(state, now)) {
        return this.topUp(state);
      }
      return state;
    });
  }

  /**
   * Channel state for the gateway, so admission can reject early when a
   * channel is exhausted or otherwise unusable.
   */
  async getState(principal: string, provider: string): Promise<ChannelState | undefined> {
    return this.store.get(ChannelManager.key(principal, provider));
  }

  /**
   * Whether the gateway should admit a call for this pair. Returns false when
   * there is no channel or the channel is exhausted / failed.
   */
  async canAdmit(principal: string, provider: string): Promise<boolean> {
    const state = await this.getState(principal, provider);
    return state !== undefined && this.isUsable(state);
  }

  /** Close a channel and release remaining funds. */
  async close(principal: string, provider: string): Promise<void> {
    const key = ChannelManager.key(principal, provider);
    await this.serialize(key, async () => {
      const state = await this.store.get(key);
      if (!state || !state.channelId) {
        await this.store.delete(key);
        return state ?? this.placeholder(principal, provider);
      }
      await this.backend.closeChannel({ channelId: state.channelId });
      state.status = "closed";
      state.balance = 0n;
      await this.store.put(state);
      return state;
    });
  }

  // --- internals ---------------------------------------------------------

  private async openChannel(principal: string, provider: string): Promise<ChannelState> {
    const key = ChannelManager.key(principal, provider);
    const authorized = await this.authorizer.authorize({
      principal,
      provider,
      amount: this.initialDeposit,
      reason: "open",
    });
    if (!authorized) {
      throw new ChannelError(`principal ${principal} declined channel open`);
    }

    // Mark the channel as opening but do NOT persist it as usable yet. If the
    // backend open fails mid-flight we must not leave a half-opened channel
    // that the store believes is usable.
    const opening: ChannelState = {
      key,
      principal,
      provider,
      status: "opening",
      balance: 0n,
      burnRate: 0,
      lastUpdated: this.now(),
    };

    let opened: { channelId: string; balance: bigint };
    try {
      opened = await this.backend.openChannel({
        principal,
        provider,
        deposit: this.initialDeposit,
      });
    } catch (err) {
      // Roll back: ensure nothing usable is left behind for this key.
      await this.store.delete(key);
      throw new ChannelError(`failed to open channel for ${key}`, err);
    }

    if (!opened.channelId) {
      await this.store.delete(key);
      throw new ChannelError(`backend returned no channel id for ${key}`);
    }

    const now = this.now();
    const state: ChannelState = {
      ...opening,
      channelId: opened.channelId,
      status: "open",
      balance: opened.balance,
      lastUpdated: now,
      projectedExhaustion: this.projectExhaustion(
        { ...opening, balance: opened.balance, burnRate: 0 },
        now,
      ),
    };
    // Only now, after a fully committed open, is the channel persisted as
    // usable.
    await this.store.put(state);
    return state;
  }

  private async topUp(state: ChannelState): Promise<ChannelState> {
    if (!state.channelId) {
      throw new ChannelError(`cannot top up channel without id for ${state.key}`);
    }
    const authorized = await this.authorizer.authorize({
      principal: state.principal,
      provider: state.provider,
      amount: this.topUpAmount,
      reason: "top_up",
    });
    if (!authorized) {
      // Not authorized: leave the channel as-is; admission will reject once
      // it is exhausted.
      return state;
    }

    state.status = "topping_up";
    await this.store.put(state);

    let result: { balance: bigint };
    try {
      result = await this.backend.topUp({
        channelId: state.channelId,
        amount: this.topUpAmount,
      });
    } catch (err) {
      // Top-up failed: restore the previous status so the channel is not left
      // stuck in a transient state.
      state.status = state.balance === 0n ? "exhausted" : "open";
      await this.store.put(state);
      throw new ChannelError(`failed to top up channel ${state.channelId}`, err);
    }

    const now = this.now();
    state.balance = result.balance;
    state.status = "open";
    state.lastUpdated = now;
    state.projectedExhaustion = this.projectExhaustion(state, now);
    await this.store.put(state);
    return state;
  }

  private shouldTopUp(state: ChannelState, now: number): boolean {
    if (state.status !== "open" || !state.channelId) {
      return false;
    }
    if (state.balance === 0n) {
      return false;
    }
    const threshold = Number(state.balance) * this.topUpThreshold;
    const belowThreshold = Number(state.balance) <= threshold;
    const nearExhaustion =
      state.projectedExhaustion !== undefined &&
      state.projectedExhaustion - now <= this.safetyWindowMs;
    return belowThreshold || nearExhaustion;
  }

  private projectExhaustion(state: ChannelState, now: number): number | undefined {
    if (state.burnRate <= 0) {
      return undefined;
    }
    const remainingMs = Number(state.balance) / state.burnRate;
    if (!Number.isFinite(remainingMs)) {
      return undefined;
    }
    return now + remainingMs;
  }

  private ewma(previous: number, sample: number): number {
    if (previous <= 0) {
      return sample;
    }
    const alpha = 2 / (this.burnWindow + 1);
    return previous * (1 - alpha) + sample * alpha;
  }

  private isUsable(state: ChannelState): boolean {
    return (
      (state.status === "open" || state.status === "topping_up") &&
      state.channelId !== undefined &&
      state.balance > 0n
    );
  }

  private placeholder(principal: string, provider: string): ChannelState {
    return {
      key: ChannelManager.key(principal, provider),
      principal,
      provider,
      status: "closed",
      balance: 0n,
      burnRate: 0,
      lastUpdated: this.now(),
    };
  }

  /** Serialize lifecycle work per key so concurrent calls cannot race. */
  private serialize(
    key: string,
    work: () => Promise<ChannelState>,
  ): Promise<ChannelState> {
    const previous = this.inflight.get(key) ?? Promise.resolve(undefined as unknown as ChannelState);
    const next = previous
      .catch(() => undefined)
      .then(() => work());
    this.inflight.set(
      key,
      next.finally(() => {
        if (this.inflight.get(key) === next) {
          this.inflight.delete(key);
        }
      }),
    );
    return next;
  }
}
