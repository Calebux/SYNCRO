import { EventEmitter } from 'events';

/**
 * Minimal structural types for the settlement watcher. These mirror the
 * shapes produced by the channel/state layer without importing it directly,
 * so the watcher stays decoupled from the rest of the service.
 */
export interface ChannelState {
  channelId: string;
  /** Monotonically increasing nonce of the newest state we hold locally. */
  nonce: number;
  /** Opaque signed state payload, forwarded verbatim to `dispute`. */
  state: unknown;
}

export interface CloseInitiatedEvent {
  channelId: string;
  /** Nonce of the state the counterparty submitted with the close. */
  nonce: number;
  /** Opaque signed state payload submitted by the counterparty. */
  state: unknown;
}

/**
 * The settlement client this watcher drives. Implemented by the channel
 * service; kept as an interface so the watcher is unit-testable.
 */
export interface SettlementClient {
  /** Submit a newer state to contest a stale close. */
  dispute(channelId: string, state: unknown): Promise<void>;
}

/**
 * Source of channel events. `on` subscribes to `closeInitiated` events for
 * every channel this service holds state for.
 */
export interface ChannelEventSource {
  on(event: 'closeInitiated', listener: (event: CloseInitiatedEvent) => void): void;
  off?(event: 'closeInitiated', listener: (event: CloseInitiatedEvent) => void): void;
}

/**
 * Sink for loud alerts. A stale-state close is either a bug or an attack, so
 * every detection is reported regardless of whether the dispute succeeded.
 */
export interface AlertSink {
  alert(message: string, context?: Record<string, unknown>): void;
}

/**
 * Liveness probe. The watcher must prove it is alive on a fixed cadence; a
 * silently dead watcher is the worst possible failure mode here.
 */
export interface LivenessMonitor {
  heartbeat(): void;
}

export interface DisputeWatcherOptions {
  client: SettlementClient;
  events: ChannelEventSource;
  alerts: AlertSink;
  liveness: LivenessMonitor;
  /** Look up the newest state we hold for a channel, if any. */
  getLocalState: (channelId: string) => ChannelState | undefined | Promise<ChannelState | undefined>;
  /** Heartbeat cadence in ms. Defaults to 30s. */
  heartbeatIntervalMs?: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Watches close initiations on every channel we hold state for, contests
 * stale closes automatically, and alerts loudly on every detection.
 */
export class DisputeWatcher extends EventEmitter {
  private readonly client: SettlementClient;
  private readonly events: ChannelEventSource;
  private readonly alerts: AlertSink;
  private readonly liveness: LivenessMonitor;
  private readonly getLocalState: DisputeWatcherOptions['getLocalState'];
  private readonly heartbeatIntervalMs: number;

  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private started = false;

  private readonly onCloseInitiated = (event: CloseInitiatedEvent): void => {
    // Fire-and-forget: the event source does not await listeners, and a slow
    // dispute must not block subsequent close events.
    void this.handleCloseInitiated(event).catch((err) => {
      this.alerts.alert('dispute watcher failed to handle close initiation', {
        channelId: event.channelId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };

  constructor(options: DisputeWatcherOptions) {
    super();
    this.client = options.client;
    this.events = options.events;
    this.alerts = options.alerts;
    this.liveness = options.liveness;
    this.getLocalState = options.getLocalState;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  /** Begin watching close initiations and emitting liveness heartbeats. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.events.on('closeInitiated', this.onCloseInitiated);
    this.heartbeatTimer = setInterval(() => {
      try {
        this.liveness.heartbeat();
      } catch (err) {
        this.alerts.alert('dispute watcher liveness heartbeat failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, this.heartbeatIntervalMs);
    // Do not keep the process alive solely for the heartbeat.
    this.heartbeatTimer.unref?.();
  }

  /** Stop watching and cease heartbeats. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.events.off?.('closeInitiated', this.onCloseInitiated);
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Compare the submitted close state against our newest local state and
   * dispute when ours is newer. Alerts loudly either way.
   */
  async handleCloseInitiated(event: CloseInitiatedEvent): Promise<void> {
    const local = await this.getLocalState(event.channelId);

    if (!local) {
      this.alerts.alert('close initiated on channel with no local state', {
        channelId: event.channelId,
        submittedNonce: event.nonce,
      });
      return;
    }

    if (local.nonce <= event.nonce) {
      // Submitted state is at least as new as ours: nothing to contest, but
      // still surface it so operators can confirm the close is expected.
      this.alerts.alert('close initiated with non-stale state', {
        channelId: event.channelId,
        submittedNonce: event.nonce,
        localNonce: local.nonce,
      });
      return;
    }

    // Local state is strictly newer: this is a stale-state close, which is
    // either a bug or an attack. Alert first so the detection is never lost
    // even if the dispute submission throws.
    this.alerts.alert('stale-state close detected; disputing with newer local state', {
      channelId: event.channelId,
      submittedNonce: event.nonce,
      localNonce: local.nonce,
    });

    try {
      await this.client.dispute(event.channelId, local.state);
      this.alerts.alert('dispute submitted for stale-state close', {
        channelId: event.channelId,
        submittedNonce: event.nonce,
        localNonce: local.nonce,
      });
    } catch (err) {
      this.alerts.alert('failed to dispute stale-state close', {
        channelId: event.channelId,
        submittedNonce: event.nonce,
        localNonce: local.nonce,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
