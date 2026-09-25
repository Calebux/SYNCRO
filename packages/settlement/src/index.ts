/**
 * Settlement engine — channel lifecycle manager.
 *
 * Channels are infrastructure that must exist before a call can be paid for.
 * This module opens channels on demand, monitors their remaining balance,
 * projects time-to-exhaustion from recent burn rate, and tops up before
 * exhaustion (subject to the principal's authorization).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChannelState {
  channelId: string;
  principal: string;
  provider: string;
  /** Total funds currently committed to the channel. */
  deposit: bigint;
  /** Funds already spent from the channel. */
  spent: bigint;
  /** Whether the channel is open and usable for payments. */
  open: boolean;
  /** Timestamp (ms) of the last observed activity. */
  updatedAt: number;
}

export interface ChannelStore {
  get(principal: string, provider: string): Promise<ChannelState | undefined>;
  put(state: ChannelState): Promise<void>;
  delete(principal: string, provider: string): Promise<void>;
}

export interface ChannelOpener {
  /**
   * Open a channel on-chain. Must either fully succeed (returning the opened
   * channel) or throw. A partial open must never be reported as success.
   */
  open(principal: string, provider: string, deposit: bigint): Promise<{ channelId: string }>;
  /** Add funds to an existing channel. */
  topUp(channelId: string, amount: bigint): Promise<void>;
}

export interface ChannelAuthorizer {
  /**
   * Ask the principal whether a top-up of `amount` is authorized.
   * Returns true when the principal approves the spend.
   */
  authorizeTopUp(principal: string, provider: string, amount: bigint): Promise<boolean>;
}

export interface ChannelLifecycleOptions {
  store: ChannelStore;
  opener: ChannelOpener;
  authorizer: ChannelAuthorizer;
  /** Initial deposit used when opening a channel on demand. */
  initialDeposit: bigint;
  /** Top-up amount applied when a channel nears exhaustion. */
  topUpAmount: bigint;
  /** Fraction of the deposit remaining at which a top-up is triggered. */
  topUpThreshold?: number;
  /** Number of recent samples used to estimate burn rate. */
  burnWindow?: number;
  /** Injectable clock for testing. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Burn-rate tracking
// ---------------------------------------------------------------------------

interface BurnSample {
  spent: bigint;
  at: number;
}

// ---------------------------------------------------------------------------
// Channel lifecycle manager
// ---------------------------------------------------------------------------

export class ChannelLifecycleManager {
  private readonly store: ChannelStore;
  private readonly opener: ChannelOpener;
  private readonly authorizer: ChannelAuthorizer;
  private readonly initialDeposit: bigint;
  private readonly topUpAmount: bigint;
  private readonly topUpThreshold: number;
  private readonly burnWindow: number;
  private readonly now: () => number;

  /** Recent spend samples per channel, used to project exhaustion. */
  private readonly burnSamples = new Map<string, BurnSample[]>();

  /** In-flight opens, so concurrent first calls share a single open. */
  private readonly pendingOpens = new Map<string, Promise<ChannelState>>();

  constructor(options: ChannelLifecycleOptions) {
    this.store = options.store;
    this.opener = options.opener;
    this.authorizer = options.authorizer;
    this.initialDeposit = options.initialDeposit;
    this.topUpAmount = options.topUpAmount;
    this.topUpThreshold = options.topUpThreshold ?? 0.2;
    this.burnWindow = options.burnWindow ?? 8;
    this.now = options.now ?? (() => Date.now());
  }

  private key(principal: string, provider: string): string {
    return `${principal}::${provider}`;
  }

  /**
   * Ensure a usable channel exists for (principal, provider), opening one on
   * demand with a sensible initial deposit when the principal first pays.
   */
  async ensureChannel(principal: string, provider: string): Promise<ChannelState> {
    const existing = await this.store.get(principal, provider);
    if (existing && existing.open) {
      return existing;
    }

    const key = this.key(principal, provider);
    const pending = this.pendingOpens.get(key);
    if (pending) {
      return pending;
    }

    const openPromise = this.openChannel(principal, provider).finally(() => {
      this.pendingOpens.delete(key);
    });
    this.pendingOpens.set(key, openPromise);
    return openPromise;
  }

  private async openChannel(principal: string, provider: string): Promise<ChannelState> {
    let channelId: string;
    try {
      const opened = await this.opener.open(principal, provider, this.initialDeposit);
      channelId = opened.channelId;
    } catch (err) {
      // The open failed mid-flight. Never persist a half-opened channel that
      // the database would believe is usable.
      await this.store.delete(principal, provider);
      throw err;
    }

    const state: ChannelState = {
      channelId,
      principal,
      provider,
      deposit: this.initialDeposit,
      spent: 0n,
      open: true,
      updatedAt: this.now(),
    };

    try {
      await this.store.put(state);
    } catch (err) {
      // Persisting failed after the channel was opened: roll back the record
      // so we do not leave a channel the database believes is usable.
      await this.store.delete(principal, provider);
      throw err;
    }

    return state;
  }

  /**
   * Record spend against a channel and top it up before exhaustion when the
   * principal authorizes it.
   */
  async recordSpend(principal: string, provider: string, amount: bigint): Promise<ChannelState> {
    const state = await this.ensureChannel(principal, provider);
    const updated: ChannelState = {
      ...state,
      spent: state.spent + amount,
      updatedAt: this.now(),
    };
    await this.store.put(updated);
    this.recordBurnSample(updated);

    if (this.shouldTopUp(updated)) {
      return this.topUp(updated);
    }
    return updated;
  }

  private recordBurnSample(state: ChannelState): void {
    const key = this.key(state.principal, state.provider);
    const samples = this.burnSamples.get(key) ?? [];
    samples.push({ spent: state.spent, at: state.updatedAt });
    while (samples.length > this.burnWindow) {
      samples.shift();
    }
    this.burnSamples.set(key, samples);
  }

  /** Remaining funds available in the channel. */
  remaining(state: ChannelState): bigint {
    const remaining = state.deposit - state.spent;
    return remaining > 0n ? remaining : 0n;
  }

  /**
   * Project time-to-exhaustion (ms) from the recent burn rate. Returns
   * Infinity when there is no measurable burn, and 0 when already exhausted.
   */
  projectTimeToExhaustion(state: ChannelState): number {
    const remaining = this.remaining(state);
    if (remaining <= 0n) {
      return 0;
    }

    const key = this.key(state.principal, state.provider);
    const samples = this.burnSamples.get(key) ?? [];
    if (samples.length < 2) {
      return Infinity;
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = last.at - first.at;
    const burned = last.spent - first.spent;
    if (elapsed <= 0 || burned <= 0n) {
      return Infinity;
    }

    const burnPerMs = Number(burned) / elapsed;
    if (burnPerMs <= 0) {
      return Infinity;
    }
    return Number(remaining) / burnPerMs;
  }

  private shouldTopUp(state: ChannelState): boolean {
    const remaining = this.remaining(state);
    if (remaining <= 0n) {
      return true;
    }
    const threshold = BigInt(Math.floor(Number(state.deposit) * this.topUpThreshold));
    return remaining <= threshold;
  }

  /**
   * Top up a channel before exhaustion, subject to the principal's
   * authorization. If the principal declines, the channel is left untouched.
   */
  async topUp(state: ChannelState): Promise<ChannelState> {
    const authorized = await this.authorizer.authorizeTopUp(
      state.principal,
      state.provider,
      this.topUpAmount,
    );
    if (!authorized) {
      return state;
    }

    await this.opener.topUp(state.channelId, this.topUpAmount);

    const updated: ChannelState = {
      ...state,
      deposit: state.deposit + this.topUpAmount,
      updatedAt: this.now(),
    };
    await this.store.put(updated);
    return updated;
  }

  /**
   * Channel state exposed to the gateway so admission can reject early when a
   * channel is exhausted.
   */
  async getChannelState(principal: string, provider: string): Promise<ChannelState | undefined> {
    return this.store.get(principal, provider);
  }

  /**
   * Admission helper: true when the channel can accept another payment of
   * `amount` without being exhausted.
   */
  async canAdmit(principal: string, provider: string, amount: bigint): Promise<boolean> {
    const state = await this.store.get(principal, provider);
    if (!state || !state.open) {
      return false;
    }
    return this.remaining(state) >= amount;
  }
}
