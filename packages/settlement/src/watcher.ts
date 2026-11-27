import { EventEmitter } from 'events';
import { setTimeout as delay } from 'timers/promises';

/**
 * Minimal structural types for the settlement watcher.
 *
 * These are intentionally narrow so the watcher can be wired to whatever
 * channel/state client the service already uses without pulling in a
 * concrete dependency here.
 */
export interface ChannelState {
  channelId: string;
  /** Monotonically increasing version of the state. */
  nonce: number;
  /** Opaque, chain-specific encoded state submitted via `dispute`. */
  encoded: string;
}

export interface CloseInitiatedEvent {
  channelId: string;
  /** The state the counterparty submitted when initiating close. */
  state: ChannelState;
}

export interface ChannelClient {
  /** Subscribe to close-initiation events for every channel we hold state for. */
  onCloseInitiated(handler: (event: CloseInitiatedEvent) => void): void;
  /** Newest state we hold locally for a channel, or undefined if unknown. */
  getLatestState(channelId: string): Promise<ChannelState | undefined>;
  /** Submit our newer state to contest a stale close. */
  dispute(channelId: string, state: ChannelState): Promise<void>;
}

export interface AlertSink {
  /** Fire a loud, actionable alert. Must not throw. */
  alert(message: string, meta?: Record<string, unknown>): void;
}

export interface WatcherOptions {
  client: ChannelClient;
  alerts: AlertSink;
  /**
   * How long the watcher may go without observing any channel activity before
   * its liveness alarm fires. A silently dead watcher is the worst failure
   * mode here, so this must be short enough to catch a crash within minutes.
   */
  livenessTimeoutMs?: number;
  /** How often the liveness watchdog checks in. */
  livenessCheckIntervalMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

const DEFAULT_LIVENESS_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_LIVENESS_CHECK_INTERVAL_MS = 15 * 1000;

/**
 * Watches channel events for close initiation and automatically disputes any
 * close backed by a state older than the newest state we hold locally.
 *
 * A stale-state close is either a bug or an attack, so we always alert loudly
 * regardless of whether we were able to dispute it.
 */
export class SettlementWatcher extends EventEmitter {
  private readonly client: ChannelClient;
  private readonly alerts: AlertSink;
  private readonly livenessTimeoutMs: number;
  private readonly livenessCheckIntervalMs: number;
  private readonly now: () => number;

  private lastActivityAt: number;
  private watchdog?: NodeJS.Timeout;
  private started = false;
  private livenessAlarmed = false;

  constructor(options: WatcherOptions) {
    super();
    this.client = options.client;
    this.alerts = options.alerts;
    this.livenessTimeoutMs = options.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;
    this.livenessCheckIntervalMs =
      options.livenessCheckIntervalMs ?? DEFAULT_LIVENESS_CHECK_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    this.lastActivityAt = this.now();
  }

  /** Begin watching close-initiation events and the liveness watchdog. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastActivityAt = this.now();
    this.livenessAlarmed = false;

    this.client.onCloseInitiated((event) => {
      this.recordActivity();
      void this.handleCloseInitiated(event);
    });

    this.watchdog = setInterval(() => this.checkLiveness(), this.livenessCheckIntervalMs);
    // Do not keep the process alive solely for the watchdog.
    if (typeof this.watchdog.unref === 'function') this.watchdog.unref();
  }

  /** Stop watching. */
  stop(): void {
    this.started = false;
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = undefined;
    }
  }

  /**
   * Handle a close-initiation event: compare the submitted nonce against the
   * newest state we hold locally and dispute when ours is newer.
   */
  async handleCloseInitiated(event: CloseInitiatedEvent): Promise<void> {
    const { channelId, state: submitted } = event;

    let local: ChannelState | undefined;
    try {
      local = await this.client.getLatestState(channelId);
    } catch (err) {
      this.alerts.alert(
        `Settlement watcher: failed to read local state for channel ${channelId} during close initiation`,
        { channelId, error: err },
      );
      return;
    }

    if (!local) {
      this.alerts.alert(
        `Settlement watcher: close initiated on channel ${channelId} but no local state is held`,
        { channelId, submittedNonce: submitted.nonce },
      );
      return;
    }

    if (local.nonce <= submitted.nonce) {
      // Submitted state is current (or newer than anything we hold). Nothing to
      // dispute, but a close is still worth surfacing.
      this.emit('close-observed', { channelId, submittedNonce: submitted.nonce, localNonce: local.nonce });
      return;
    }

    // Local state is strictly newer: this is a stale-state close. Alert loudly
    // regardless of the dispute outcome, then contest it automatically.
    this.alerts.alert(
      `Settlement watcher: STALE-STATE CLOSE on channel ${channelId} ` +
        `(submitted nonce ${submitted.nonce}, local nonce ${local.nonce}). Disputing automatically.`,
      { channelId, submittedNonce: submitted.nonce, localNonce: local.nonce },
    );

    try {
      await this.client.dispute(channelId, local);
      this.emit('disputed', { channelId, submittedNonce: submitted.nonce, localNonce: local.nonce });
    } catch (err) {
      this.alerts.alert(
        `Settlement watcher: FAILED to dispute stale close on channel ${channelId} ` +
          `(submitted nonce ${submitted.nonce}, local nonce ${local.nonce}). Manual intervention required.`,
        { channelId, submittedNonce: submitted.nonce, localNonce: local.nonce, error: err },
      );
    }
  }

  /** Record that the watcher observed activity, resetting the liveness clock. */
  recordActivity(): void {
    this.lastActivityAt = this.now();
    this.livenessAlarmed = false;
  }

  private checkLiveness(): void {
    if (!this.started || this.livenessAlarmed) return;
    const idleMs = this.now() - this.lastActivityAt;
    if (idleMs >= this.livenessTimeoutMs) {
      this.livenessAlarmed = true;
      this.alerts.alert(
        `Settlement watcher: LIVENESS ALARM - no channel activity observed for ${Math.round(
          idleMs / 1000,
        )}s. The watcher may be dead and stale closes will go unchallenged.`,
        { idleMs, livenessTimeoutMs: this.livenessTimeoutMs },
      );
    }
  }
}

/**
 * Convenience helper: run the watcher until the returned stop function is
 * called. Keeps the process alive while watching.
 */
export async function runSettlementWatcher(options: WatcherOptions): Promise<() => void> {
  const watcher = new SettlementWatcher(options);
  watcher.start();
  // Keep the event loop alive while the watcher is running.
  await delay(0);
  return () => watcher.stop();
}
