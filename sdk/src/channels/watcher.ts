/**
 * Consumer-side dispute watcher (issue #1796).
 *
 * A trust-minimised consumer should not depend on SYNCRO's settlement engine
 * to defend its balance. This module runs an autonomous watcher that:
 *
 *  1. Polls the on-chain state of a set of channels at a configurable interval.
 *  2. Detects when a channel enters the `closing` state with a nonce that is
 *     older than the newest signed state the consumer holds in its store.
 *  3. Submits the consumer's latest signed state via the `dispute` contract
 *     method, overwriting the stale close before the challenge window expires.
 *  4. Fires an `onDeadlineApproaching` alert callback when the remaining
 *     challenge time falls below a configurable threshold.
 *
 * ## Usage as a library
 *
 * ```ts
 * const handle = watchChannels({
 *   channelIds: [1n, 2n],
 *   contractId: "CCHANNEL_CONTRACT",
 *   caller: consumerAddress,
 *   store,
 *   signer,
 *   transport,
 *   onDisputeSubmitted: (ev) => logger.info("dispute won", ev),
 *   onDeadlineApproaching: (ev) => alertOps("close window ending soon", ev),
 * });
 *
 * // Later, to stop the watcher:
 * handle.stop();
 * await handle.stopped;
 * ```
 *
 * ## Usage as a CLI daemon
 *
 * See `sdk/src/cli/dispute-watcher.ts`. Run with:
 *   `node dispute-watcher.js --contract CCHANNEL --caller GCALLERADDR ...`
 */

import type { ChannelTransport, ChannelView, ChannelLifecycleState } from "./client.js";
import { ValidationError } from "../errors.js";

// ─── State store ──────────────────────────────────────────────────────────────

/**
 * The latest signed channel state the consumer holds for one channel.
 * The watcher reads this when it needs to respond to a stale close.
 */
export interface SignedChannelState {
  channelId: bigint;
  /** The highest nonce (sequence) the consumer has signed. */
  sequence: bigint;
  /** Depositor balance at this state. */
  balanceA: bigint;
  /** Counterparty balance at this state. */
  balanceB: bigint;
  /** Consumer's signature over the state (opaque bytes, passed to the contract as-is). */
  signature: string;
}

/**
 * Persistent storage interface for channel states.
 *
 * The watcher only ever calls `getLatest`; your implementation can be as
 * simple as an in-memory Map or as durable as a SQLite database.
 */
export interface ChannelStateStore {
  /**
   * Return the newest signed state the consumer holds for `channelId`,
   * or `null` if none is known.
   */
  getLatest(channelId: bigint): Promise<SignedChannelState | null> | SignedChannelState | null;
}

// ─── Signer ───────────────────────────────────────────────────────────────────

/**
 * Signs a dispute payload before submission.
 *
 * The watcher calls `sign` with the channel state it intends to submit.
 * Return the hex- or base64-encoded signature. If the state already carries a
 * valid pre-signed signature from the store you may return that value unchanged.
 */
export interface DisputeSigner {
  sign(state: SignedChannelState): Promise<string> | string;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/** Fired when the watcher successfully submits a dispute. */
export interface DisputeSubmittedEvent {
  channelId: bigint;
  /** The nonce the counterparty tried to close at. */
  stalSequence: bigint;
  /** The nonce the watcher used to win the dispute. */
  ourSequence: bigint;
  /** Current on-chain state after the dispute call. */
  channelState: ChannelLifecycleState;
  submittedAt: number; // ms timestamp
}

/** Fired when the remaining dispute window falls below the alert threshold. */
export interface DeadlineApproachingEvent {
  channelId: bigint;
  disputeDeadline: bigint; // unix seconds
  remainingSeconds: bigint;
  /** Whether a dispute has already been submitted for this close attempt. */
  alreadyDisputed: boolean;
}

/** Fired when a dispute submission fails. The watcher keeps running. */
export interface DisputeErrorEvent {
  channelId: bigint;
  error: unknown;
  attemptedAt: number; // ms timestamp
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface WatchChannelsOptions {
  /** IDs of the channels to watch. */
  channelIds: readonly bigint[];
  /** Soroban contract ID hosting the payment-channel logic. */
  contractId: string;
  /** Consumer's address (used as the `sourceAccount` on dispute transactions). */
  caller: string;
  /** Persistent store of the consumer's latest signed states. */
  store: ChannelStateStore;
  /** Signs dispute payloads before submission. */
  signer: DisputeSigner;
  /** Transport for on-chain reads and dispute submissions. */
  transport: ChannelTransport;
  /**
   * How often (ms) to poll the chain for each channel's state.
   * Defaults to 10 000 ms (10 s). Lower values give faster reaction but
   * consume more RPC quota.
   */
  pollIntervalMs?: number;
  /**
   * Fire `onDeadlineApproaching` when the remaining challenge window is at or
   * below this many seconds. Defaults to 300 (5 minutes).
   */
  alertThresholdSeconds?: bigint;
  /**
   * Called when the watcher wins a dispute by submitting a newer state.
   * Errors thrown inside this callback are swallowed so the watcher keeps
   * running.
   */
  onDisputeSubmitted?: (event: DisputeSubmittedEvent) => void | Promise<void>;
  /**
   * Called on every poll tick when the remaining challenge time for a closing
   * channel is at or below `alertThresholdSeconds`.
   */
  onDeadlineApproaching?: (event: DeadlineApproachingEvent) => void | Promise<void>;
  /**
   * Called when a dispute submission attempt throws. The watcher will retry on
   * the next poll. Errors thrown inside this callback are swallowed.
   */
  onDisputeError?: (event: DisputeErrorEvent) => void | Promise<void>;
  /**
   * Millisecond clock — injectable so tests can control time without real
   * delays.
   */
  now?: () => number;
  /**
   * Sleep function — injectable so tests can stub out `setTimeout` and tick
   * the watcher forward deterministically.
   */
  sleep?: (ms: number) => Promise<void>;
}

// ─── Handle ───────────────────────────────────────────────────────────────────

/** Returned by `watchChannels`. Use `stop()` to end the watch loop. */
export interface WatchHandle {
  /** Request the watcher to stop after the current poll tick completes. */
  stop(): void;
  /** Resolves when the watcher loop has fully exited. */
  readonly stopped: Promise<void>;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Start watching `channelIds` for stale closes and automatically dispute them.
 *
 * The returned {@link WatchHandle} lets the caller stop the loop cleanly.
 * The watcher is non-blocking: it runs asynchronously in the background.
 */
export function watchChannels(options: WatchChannelsOptions): WatchHandle {
  validateOptions(options);

  const {
    channelIds,
    contractId,
    caller,
    store,
    signer,
    transport,
    pollIntervalMs = 10_000,
    alertThresholdSeconds = 300n,
    onDisputeSubmitted,
    onDeadlineApproaching,
    onDisputeError,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = options;

  /**
   * Track per-channel which nonce we already successfully disputed, so we
   * don't re-submit on subsequent ticks while the channel is still `closing`.
   * Key: channelId.toString(), Value: sequence we disputed with.
   */
  const disputedAtSequence = new Map<string, bigint>();

  let stopping = false;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((r) => { resolveStopped = r; });

  async function poll(): Promise<void> {
    for (const channelId of channelIds) {
      if (stopping) break;
      try {
        await checkChannel(channelId);
      } catch {
        // Per-channel errors must not kill the whole loop.
      }
    }
  }

  async function checkChannel(channelId: bigint): Promise<void> {
    const raw = await transport.read({
      contractId,
      method: "get_channel",
      args: { channel_id: channelId },
      sourceAccount: caller,
    });

    if (raw == null) return; // channel not yet opened or already cleaned up

    const channel = decodeChannelView(raw);

    if (channel.state !== "closing") return;

    const nowSec = BigInt(Math.floor(now() / 1000));
    const remaining =
      channel.disputeDeadline > nowSec ? channel.disputeDeadline - nowSec : 0n;

    // Check whether we already won a dispute for this exact close attempt.
    const disputedSeq = disputedAtSequence.get(channelId.toString());
    const alreadyDisputed =
      disputedSeq !== undefined && disputedSeq > channel.sequence;

    // Alert if inside the threshold window.
    if (remaining <= alertThresholdSeconds && onDeadlineApproaching) {
      void safeCall(() =>
        onDeadlineApproaching({
          channelId,
          disputeDeadline: channel.disputeDeadline,
          remainingSeconds: remaining,
          alreadyDisputed,
        }),
      );
    }

    // If we already won the dispute for this close, nothing more to do.
    if (alreadyDisputed) return;

    // Fetch our latest signed state.
    const latest = await store.getLatest(channelId);
    if (latest == null) return; // no state to dispute with

    // If the on-chain sequence is already equal or newer, nothing to dispute.
    if (channel.sequence >= latest.sequence) return;

    // The chain was closed at a stale nonce. Submit our newer state.
    await submitDispute(channel, latest);
  }

  async function submitDispute(
    channel: ChannelView,
    state: SignedChannelState,
  ): Promise<void> {
    try {
      const sig = await signer.sign(state);

      await transport.invoke({
        contractId,
        method: "dispute",
        args: {
          channel_id:  channel.id,
          balance_a:   state.balanceA,
          balance_b:   state.balanceB,
          seq:         state.sequence,
          sig,
        },
        sourceAccount: caller,
      });

      // Record that we won this close attempt.
      disputedAtSequence.set(channel.id.toString(), state.sequence);

      void safeCall(() =>
        onDisputeSubmitted?.({
          channelId:    channel.id,
          stalSequence: channel.sequence,
          ourSequence:  state.sequence,
          channelState: "dispute",
          submittedAt:  now(),
        }),
      );
    } catch (err) {
      void safeCall(() =>
        onDisputeError?.({
          channelId:   channel.id,
          error:       err,
          attemptedAt: now(),
        }),
      );
      throw err; // re-throw so checkChannel can record the failure
    }
  }

  async function loop(): Promise<void> {
    try {
      while (!stopping) {
        await poll();
        if (!stopping) await sleep(pollIntervalMs);
      }
    } finally {
      resolveStopped();
    }
  }

  // Start the loop in the background.
  void loop();

  return {
    stop() { stopping = true; },
    stopped,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode a raw transport read result into a `ChannelView`-compatible shape.
 * We only need a small subset of fields here so we don't import the full
 * `decodeChannel` from client.ts (which is not exported).
 */
function decodeChannelView(raw: unknown): ChannelView {
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError("Channel response must be an object.");
  }
  const r = raw as Record<string, unknown>;
  return {
    id:                  requireBigint(r["id"],                   "id"),
    depositor:           requireString(r["depositor"],            "depositor"),
    counterparty:        requireString(r["counterparty"],         "counterparty"),
    token:               requireString(r["token"],                "token"),
    balance:             requireBigint(r["balance_a"],            "balance_a"),
    counterpartyBalance: requireBigint(r["balance_b"],            "balance_b"),
    sequence:            requireBigint(r["sequence"],             "sequence"),
    state:               parseState(r["state"]),
    disputeDeadline:     requireBigint(r["dispute_deadline"],     "dispute_deadline"),
    closingStartedAt:    requireBigint(r["closing_started_at"],   "closing_started_at"),
  };
}

function requireBigint(v: unknown, label: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^(?:0|-?[1-9]\d*)$/.test(v)) return BigInt(v);
  throw new ValidationError(`${label} must be an integer, got ${typeof v}.`);
}

function requireString(v: unknown, label: string): string {
  if (typeof v === "string" && v.length > 0) return v;
  throw new ValidationError(`${label} must be a non-empty string.`);
}

function parseState(v: unknown): ChannelLifecycleState {
  if (typeof v === "object" && v !== null && "tag" in v) {
    return parseState((v as { tag: unknown }).tag);
  }
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "open" || s === "closing" || s === "dispute" || s === "closed") {
      return s as ChannelLifecycleState;
    }
  }
  if (typeof v === "number" || typeof v === "bigint") {
    const n = Number(v);
    if (n === 1) return "open";
    if (n === 2) return "closing";
    if (n === 3) return "dispute";
    if (n === 4) return "closed";
  }
  throw new ValidationError(`Unrecognised channel state: ${String(v)}`);
}

/** Calls `fn` and swallows any thrown error so the watcher loop is never killed by a callback. */
async function safeCall(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch {
    // callbacks must not kill the watcher
  }
}

function validateOptions(o: WatchChannelsOptions): void {
  if (!Array.isArray(o.channelIds) && !isIterable(o.channelIds)) {
    throw new ValidationError("channelIds must be an array.");
  }
  if (!o.contractId || typeof o.contractId !== "string") {
    throw new ValidationError("contractId is required.");
  }
  if (!o.caller || typeof o.caller !== "string") {
    throw new ValidationError("caller is required.");
  }
  if (!o.store || typeof o.store.getLatest !== "function") {
    throw new ValidationError("store must implement getLatest().");
  }
  if (!o.signer || typeof o.signer.sign !== "function") {
    throw new ValidationError("signer must implement sign().");
  }
  if (!o.transport || typeof o.transport.invoke !== "function") {
    throw new ValidationError("transport must implement invoke() and read().");
  }
  if (o.pollIntervalMs !== undefined && (typeof o.pollIntervalMs !== "number" || o.pollIntervalMs <= 0)) {
    throw new ValidationError("pollIntervalMs must be a positive number.");
  }
}

function isIterable(v: unknown): v is Iterable<unknown> {
  return v != null && typeof (v as any)[Symbol.iterator] === "function";
}
