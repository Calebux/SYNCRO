import { EventEmitter } from 'events';
import { Channel, ChannelState, CloseInitiatedEvent, DisputeResult } from './types';
import { logger } from './logger';
import { alert } from './alerts';

/**
 * Watches channel events for close initiation and automatically disputes
 * stale-state closes. Also monitors its own liveness so a silently dead
 * watcher fires an alarm.
 */
export class SettlementWatcher extends EventEmitter {
  private channels: Map<string, Channel> = new Map();
  private livenessTimer?: NodeJS.Timeout;
  private lastHeartbeat: number = Date.now();
  private readonly livenessIntervalMs: number;
  private readonly livenessTimeoutMs: number;

  constructor(opts?: { livenessIntervalMs?: number; livenessTimeoutMs?: number }) {
    super();
    this.livenessIntervalMs = opts?.livenessIntervalMs ?? 30_000;
    this.livenessTimeoutMs = opts?.livenessTimeoutMs ?? 120_000;
  }

  /** Register a channel this service holds state for. */
  public trackChannel(channel: Channel): void {
    this.channels.set(channel.id, channel);
  }

  /** Start watching for close initiations and begin liveness monitoring. */
  public start(): void {
    this.lastHeartbeat = Date.now();
    this.livenessTimer = setInterval(() => this.checkLiveness(), this.livenessIntervalMs);
    if (this.livenessTimer.unref) this.livenessTimer.unref();
  }

  /** Stop watching and clear the liveness alarm. */
  public stop(): void {
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = undefined;
    }
  }

  /**
   * Handle a close-initiated event for a channel. Compares the submitted
   * state's nonce against the newest state held locally and, if local state
   * is newer, automatically submits it via `dispute`. Alerts loudly either way.
   */
  public async onCloseInitiated(event: CloseInitiatedEvent): Promise<DisputeResult | null> {
    this.lastHeartbeat = Date.now();

    const channel = this.channels.get(event.channelId);
    if (!channel) {
      logger.warn(`close initiated for unknown channel ${event.channelId}`);
      return null;
    }

    const localState = channel.latestState;
    const submittedState = event.state;

    if (!localState) {
      await alert('stale-close-no-local-state', {
        channelId: event.channelId,
        submittedNonce: submittedState.nonce,
      });
      return null;
    }

    const localIsNewer = localState.nonce > submittedState.nonce;

    // A stale-state close is either a bug or an attack; alert loudly regardless.
    await alert('stale-close-detected', {
      channelId: event.channelId,
      submittedNonce: submittedState.nonce,
      localNonce: localState.nonce,
      localIsNewer,
    });

    if (!localIsNewer) {
      return null;
    }

    try {
      const result = await channel.dispute(localState);
      logger.info(
        `disputed stale close on ${event.channelId}: submitted=${submittedState.nonce} local=${localState.nonce}`,
      );
      this.emit('disputed', { channelId: event.channelId, result });
      return result;
    } catch (err) {
      await alert('dispute-failed', {
        channelId: event.channelId,
        submittedNonce: submittedState.nonce,
        localNonce: localState.nonce,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Liveness check: if no heartbeat has been recorded within the timeout,
   * the watcher is considered dead and an alarm is fired.
   */
  private checkLiveness(): void {
    const elapsed = Date.now() - this.lastHeartbeat;
    if (elapsed > this.livenessTimeoutMs) {
      void alert('watcher-liveness-failure', { elapsedMs: elapsed });
    }
  }
}
