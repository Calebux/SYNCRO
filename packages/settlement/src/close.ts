import { EventEmitter } from 'events';

/**
 * Automated close and finalize for v3 settlement channels.
 *
 * Closing spans a challenge period, so it is modeled as a multi-step process:
 *  1. initiateClose  - submit the latest signed state and enter the challenge window
 *  2. acceptNewerState - counterparty may submit a genuinely newer state during the window
 *  3. finalize       - once the window elapses, settle the channel
 *
 * Pending closes are persisted so a process restart mid-window does not lose
 * track of a close that is still in flight.
 */

export interface SignedState {
  channelId: string;
  /** Monotonically increasing version of the state. */
  version: number;
  /** Opaque signed payload (e.g. serialized state + signatures). */
  payload: string;
  /** Signature over the payload, used to verify authenticity. */
  signature: string;
}

/**
 * Verifies that a signed state is authentic. Implementations are expected to
 * check the signature against the channel participants.
 */
export type VerifyState = (state: SignedState) => Promise<boolean>;

/**
 * Submits a state to the on-chain / settlement layer. Returns once the
 * submission is accepted by the underlying system.
 */
export type SubmitState = (state: SignedState) => Promise<void>;

/**
 * Finalizes a channel once its challenge window has elapsed.
 */
export type FinalizeChannel = (channelId: string) => Promise<void>;

/**
 * Persistence for pending closes so they survive a process restart.
 */
export interface PendingCloseStore {
  save(record: PendingClose): Promise<void>;
  remove(channelId: string): Promise<void>;
  list(): Promise<PendingClose[]>;
}

export interface PendingClose {
  channelId: string;
  /** The latest signed state we know about for this channel. */
  state: SignedState;
  /** Epoch millis at which the challenge window elapses. */
  challengeEndsAt: number;
  /** Epoch millis at which the close was initiated. */
  initiatedAt: number;
  /** Whether we have already alerted about an overdue close. */
  alerted?: boolean;
}

export interface CloseManagerOptions {
  verifyState: VerifyState;
  submitState: SubmitState;
  finalizeChannel: FinalizeChannel;
  store: PendingCloseStore;
  /** Challenge period in milliseconds. */
  challengePeriodMs: number;
  /** How often to scan for elapsed / overdue closes. */
  pollIntervalMs?: number;
  /** Grace beyond the challenge period before alerting. */
  overdueGraceMs?: number;
  /** Alert sink for overdue closes. */
  onOverdue?: (record: PendingClose) => void;
  /** Optional clock injection for testing. */
  now?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_OVERDUE_GRACE_MS = 60_000;

export class CloseManager extends EventEmitter {
  private readonly opts: Required<Pick<CloseManagerOptions, 'challengePeriodMs'>> &
    CloseManagerOptions;
  private readonly now: () => number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(options: CloseManagerOptions) {
    super();
    this.opts = options;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Initiate a close using the latest signed state. Can be triggered by an
   * operator action or a principal request; both paths converge here.
   */
  async initiateClose(state: SignedState): Promise<PendingClose> {
    if (!(await this.opts.verifyState(state))) {
      throw new Error(`refusing to close ${state.channelId}: invalid signed state`);
    }

    const existing = await this.getPending(state.channelId);
    if (existing) {
      // A close is already in flight. Only replace the state if the new one is
      // genuinely newer; otherwise keep the existing pending close untouched.
      if (state.version <= existing.state.version) {
        return existing;
      }
      return this.acceptNewerState(state);
    }

    await this.opts.submitState(state);

    const initiatedAt = this.now();
    const record: PendingClose = {
      channelId: state.channelId,
      state,
      initiatedAt,
      challengeEndsAt: initiatedAt + this.opts.challengePeriodMs,
    };

    await this.opts.store.save(record);
    this.emit('close:initiated', record);
    return record;
  }

  /**
   * Handle a counterparty submitting a newer state during the challenge window.
   * If the state is authentic and genuinely newer, accept it rather than
   * reflexively disputing.
   */
  async acceptNewerState(state: SignedState): Promise<PendingClose> {
    const existing = await this.getPending(state.channelId);
    if (!existing) {
      throw new Error(`no pending close for channel ${state.channelId}`);
    }

    if (state.version <= existing.state.version) {
      // Not newer: ignore it, keep the current pending close.
      return existing;
    }

    if (!(await this.opts.verifyState(state))) {
      throw new Error(`rejecting newer state for ${state.channelId}: invalid signature`);
    }

    await this.opts.submitState(state);

    const updated: PendingClose = {
      ...existing,
      state,
      // A newer state restarts the challenge window.
      challengeEndsAt: this.now() + this.opts.challengePeriodMs,
      alerted: false,
    };

    await this.opts.store.save(updated);
    this.emit('close:state-updated', updated);
    return updated;
  }

  /**
   * Scan pending closes and finalize any whose challenge window has elapsed.
   * Also alerts on closes that have been pending materially longer than the
   * challenge period.
   */
  async tick(): Promise<void> {
    const now = this.now();
    const pending = await this.opts.store.list();
    const grace = this.opts.overdueGraceMs ?? DEFAULT_OVERDUE_GRACE_MS;

    for (const record of pending) {
      if (now >= record.challengeEndsAt) {
        try {
          await this.opts.finalizeChannel(record.channelId);
          await this.opts.store.remove(record.channelId);
          this.emit('close:finalized', record);
        } catch (err) {
          this.emit('close:finalize-error', record, err);
        }
        continue;
      }

      if (!record.alerted && now >= record.challengeEndsAt + grace) {
        record.alerted = true;
        await this.opts.store.save(record);
        this.emit('close:overdue', record);
        this.opts.onOverdue?.(record);
      }
    }
  }

  /**
   * Start the background loop. On start it re-reads persisted pending closes,
   * so a process restart mid-window resumes tracking automatically.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    const interval = this.opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.emit('close:tick-error', err));
    }, interval);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    void this.tick().catch((err) => this.emit('close:tick-error', err));
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Recover pending closes after a restart. Returns the records still in
   * flight so callers can observe / log them.
   */
  async recover(): Promise<PendingClose[]> {
    const pending = await this.opts.store.list();
    this.emit('close:recovered', pending);
    return pending;
  }

  private async getPending(channelId: string): Promise<PendingClose | undefined> {
    const pending = await this.opts.store.list();
    return pending.find((p) => p.channelId === channelId);
  }
}
