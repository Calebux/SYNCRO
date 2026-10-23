/**
 * Aggregation windows for the metering layer (Issue #1443, #448).
 *
 * Every consumer of usage data has a different granularity:
 *  - **Admission** needs the current window's consumed amount in single-digit
 *    milliseconds, backed by an in-memory counter so it never touches storage.
 *  - **The console** needs hourly series for charting.
 *  - **Settlement** needs a closed window's total that is stable once the window
 *    closes — a late-arriving commit must not mutate a settled window.
 *
 * Design decisions
 * ----------------
 * 1. Window boundaries are explicit and time-aligned (floor to the duration),
 *    not implied by insertion time. `windowBoundary(ts, duration)` is the
 *    single source of truth for what window a timestamp belongs to.
 * 2. The current-window counter is held in an in-memory `Map` keyed by
 *    `{principal}:{windowStart}`. It is the fast path for admission and is never
 *    a query against a backing store.
 * 3. When a window closes its total is copied into the immutable `ClosedWindowStore`
 *    via `closeWindow()`. After that call the window is sealed: `recordUsage`
 *    will route late-arriving commits through the late-arrival policy rather
 *    than mutating the closed total.
 * 4. Late-arriving commits are never silently dropped: they are either
 *    redirected to a "late" ledger that the settlement layer can inspect, or
 *    rejected with a `LateArrivalError` when the window is already settled.
 *
 * Clock policy (ADR-017)
 * ----------------------
 * The `meterTimestampMs` parameter to `recordUsage()` MUST be the meter's own
 * clock value — i.e. `meterClock.now()`. It must NEVER be a client-supplied
 * timestamp. Client timestamps are stored as `clientTimestampMs` for audit
 * purposes only and are never used for window boundary calculations.
 *
 * Every record carries a `clockSource` field so post-hoc audits can identify
 * which clock produced the timestamp.
 */

import type { ClockSource } from './clock';

// ---------------------------------------------------------------------------
// Window boundary math
// ---------------------------------------------------------------------------

/**
 * Align `timestamp` to the start of its containing window.
 *
 * All window boundaries are multiples of `durationMs` from the Unix epoch, so
 * the same formula produces the same boundary everywhere, deterministically.
 *
 * @example
 * // 1-minute windows
 * windowBoundary(1_700_000_059_123, 60_000) === 1_700_000_000_000
 */
export function windowBoundary(timestampMs: number, durationMs: number): number {
  if (durationMs <= 0) throw new RangeError(`durationMs must be positive, got ${durationMs}`);
  return Math.floor(timestampMs / durationMs) * durationMs;
}

/** Human-readable ISO string for a window boundary. */
export function windowLabel(windowStart: number): string {
  return new Date(windowStart).toISOString();
}

// ---------------------------------------------------------------------------
// Common duration constants
// ---------------------------------------------------------------------------

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// WindowClock — injectable clock for deterministic tests
// ---------------------------------------------------------------------------

/** Returns the current wall-clock time in milliseconds. */
export type WindowClock = () => number;

export const defaultClock: WindowClock = () => Date.now();

// ---------------------------------------------------------------------------
// In-memory current-window counter (fast path for admission)
// ---------------------------------------------------------------------------

/**
 * Key for the in-memory counter: `"${principal}\x00${windowStart}"`.
 * Using `\x00` as a separator avoids collisions with any reasonable principal
 * id format while keeping the key compact.
 */
function counterKey(principal: string, windowStart: number): string {
  return `${principal}\x00${windowStart}`;
}

/**
 * Per-principal, per-window usage held in memory.
 *
 * This is the **fast path** for admission: a single `Map.get` returns the
 * running counter for the current window without any I/O. The counter is
 * reset (entry removed) when the window closes.
 */
export class CurrentWindowCounter {
  private readonly counters = new Map<string, number>();
  private readonly durationMs: number;
  private readonly clock: WindowClock;

  constructor(durationMs: number, clock: WindowClock = defaultClock) {
    if (durationMs <= 0) throw new RangeError(`durationMs must be positive, got ${durationMs}`);
    this.durationMs = durationMs;
    this.clock = clock;
  }

  /**
   * Return the usage accumulated in the current window for `principal`.
   *
   * This never touches storage. At p99 in the load test it must complete in
   * < 10 ms even under high concurrency; in practice a single Map lookup is
   * sub-millisecond.
   */
  read(principal: string): { windowStart: number; used: number } {
    const windowStart = windowBoundary(this.clock(), this.durationMs);
    const used = this.counters.get(counterKey(principal, windowStart)) ?? 0;
    return { windowStart, used };
  }

  /**
   * Increment the counter for `principal` in the window that contains
   * `meterTimestampMs`.
   *
   * @param meterTimestampMs - MUST be the meter clock's value. Never a
   *   client-supplied timestamp. (ADR-017)
   */
  increment(principal: string, meterTimestampMs: number, amount: number): number {
    if (amount <= 0) return this.counters.get(counterKey(principal, windowBoundary(meterTimestampMs, this.durationMs))) ?? 0;
    const start = windowBoundary(meterTimestampMs, this.durationMs);
    const key = counterKey(principal, start);
    const next = (this.counters.get(key) ?? 0) + amount;
    this.counters.set(key, next);
    return next;
  }

  /**
   * Drain the counter for `principal` in window `windowStart` and return its
   * total. Called by `closeWindow()` to snapshot the value before sealing.
   */
  drain(principal: string, windowStart: number): number {
    const key = counterKey(principal, windowStart);
    const total = this.counters.get(key) ?? 0;
    this.counters.delete(key);
    return total;
  }

  /** Peek at the counter without removing it (used in tests). */
  peek(principal: string, windowStart: number): number {
    return this.counters.get(counterKey(principal, windowStart)) ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Closed-window store (immutable once sealed)
// ---------------------------------------------------------------------------

/**
 * Snapshot of a closed window. Once a `ClosedWindowRecord` is written it
 * MUST NOT be mutated: settlement reads this value and relies on it being
 * stable.
 *
 * `clockSource` records which clock produced the `sealedAt` timestamp so
 * post-hoc audits can identify records made under unusual clock conditions.
 * (ADR-017)
 */
export interface ClosedWindowRecord {
  principal: string;
  windowStart: number;
  windowEnd: number;
  totalUsed: number;
  /** Unix ms when the window was sealed by `closeWindow()`. Meter clock. */
  sealedAt: number;
  /**
   * Which clock produced `sealedAt`. Always 'system' in production;
   * 'test' in unit tests using TestClock. (ADR-017)
   */
  clockSource: ClockSource;
}

/**
 * Immutable store for closed-window totals.
 *
 * `seal()` writes a record exactly once. Subsequent attempts for the same
 * `(principal, windowStart)` pair throw `WindowAlreadySealedError`. Sealed
 * records are read-only from that point forward.
 */
export class ClosedWindowStore {
  /** Outer key: principal; inner key: windowStart. */
  private readonly records = new Map<string, Map<number, ClosedWindowRecord>>();

  private principalMap(principal: string): Map<number, ClosedWindowRecord> {
    let m = this.records.get(principal);
    if (!m) {
      m = new Map();
      this.records.set(principal, m);
    }
    return m;
  }

  /**
   * Seal a closed window. Throws `WindowAlreadySealedError` if the
   * `(principal, windowStart)` pair was already sealed — closed windows are
   * immutable.
   */
  seal(record: ClosedWindowRecord): void {
    const m = this.principalMap(record.principal);
    if (m.has(record.windowStart)) {
      throw new WindowAlreadySealedError(record.principal, record.windowStart);
    }
    m.set(record.windowStart, Object.freeze({ ...record }));
  }

  /**
   * Returns the total for a closed window, or `undefined` if it has not
   * been sealed yet (the window may still be open).
   */
  getTotal(principal: string, windowStart: number): ClosedWindowRecord | undefined {
    return this.records.get(principal)?.get(windowStart);
  }

  /** Returns `true` if `(principal, windowStart)` has been sealed. */
  isSealed(principal: string, windowStart: number): boolean {
    return this.records.get(principal)?.has(windowStart) ?? false;
  }

  /**
   * Returns all closed windows for `principal`, sorted by `windowStart`
   * ascending. Used by the console read path to build time series.
   */
  series(principal: string): ClosedWindowRecord[] {
    const m = this.records.get(principal);
    if (!m) return [];
    return [...m.values()].sort((a, b) => a.windowStart - b.windowStart);
  }
}

// ---------------------------------------------------------------------------
// Late-arrival policy
// ---------------------------------------------------------------------------

/**
 * What the window store does with a commit that arrives after its window
 * was sealed.
 *
 * - `'redirect'` — record the usage in the "late" ledger (visible to ops /
 *   settlement) but do not mutate the closed window. Default.
 * - `'reject'` — throw `LateArrivalError`. Use this when you need a hard
 *   guarantee that no post-seal writes can ever enter the system.
 */
export type LateArrivalPolicy = 'redirect' | 'reject';

/**
 * Carries a late commit that was redirected rather than silently dropped.
 *
 * `meterTimestampMs` is the meter clock value at commit time. `clientTimestampMs`
 * is the caller-supplied timestamp stored for audit; it was NOT used for window
 * placement. (ADR-017)
 */
export interface LateRecord {
  principal: string;
  originalWindowStart: number;
  /** Meter clock value at the time of the late commit. Used for window placement. */
  meterTimestampMs: number;
  /**
   * Client-supplied timestamp, stored for audit only. Never used for window
   * boundary computation. (ADR-017)
   */
  clientTimestampMs?: number;
  amount: number;
  redirectedAt: number;
  /** Which clock produced `meterTimestampMs`. (ADR-017) */
  clockSource: ClockSource;
}

// ---------------------------------------------------------------------------
// WindowStore — the unified write path
// ---------------------------------------------------------------------------

export interface WindowStoreOptions {
  /** Width of each aggregation window in milliseconds. */
  durationMs: number;
  /** Injected meter clock; defaults to `Date.now`. (ADR-017) */
  clock?: WindowClock;
  /** What to do with commits that arrive after the window is sealed. */
  lateArrivalPolicy?: LateArrivalPolicy;
  /**
   * Clock source label for records produced by this store. Defaults to 'system'.
   * Use 'test' when injecting a TestClock. (ADR-017)
   */
  clockSource?: ClockSource;
}

/**
 * Coordinates the current-window counter and the closed-window store.
 *
 * ## Write path (`recordUsage`)
 * 1. Compute the window boundary for the commit's **meter** timestamp.
 * 2. If the window is already sealed → apply late-arrival policy.
 * 3. Otherwise → increment the in-memory counter.
 *
 * ## Clock contract (ADR-017)
 * `meterTimestampMs` passed to `recordUsage()` MUST be the meter clock's own
 * value — i.e. `this.clock()` from the owning `InMemoryMeter`. It must never
 * be a client-supplied timestamp. Client timestamps are stored as
 * `clientTimestampMs` for audit and are never used for boundary computation.
 *
 * ## Close path (`closeWindow`)
 * 1. Drain the in-memory counter for the window.
 * 2. Seal the drained total in the `ClosedWindowStore`.
 * The window is then immutable: any subsequent `recordUsage` for that
 * window triggers the late-arrival policy.
 *
 * ## Read path — see `usage-read.ts`.
 */
export class WindowStore {
  readonly counter: CurrentWindowCounter;
  readonly closed: ClosedWindowStore;
  readonly lateRecords: LateRecord[] = [];
  /** Width of each aggregation window in milliseconds. Public so the read path can use it. */
  readonly durationMs: number;

  private readonly lateArrivalPolicy: LateArrivalPolicy;
  private readonly clock: WindowClock;
  private readonly clockSource: ClockSource;

  constructor(options: WindowStoreOptions) {
    this.durationMs = options.durationMs;
    this.clock = options.clock ?? defaultClock;
    this.lateArrivalPolicy = options.lateArrivalPolicy ?? 'redirect';
    this.clockSource = options.clockSource ?? 'system';
    this.counter = new CurrentWindowCounter(this.durationMs, this.clock);
    this.closed = new ClosedWindowStore();
  }

  /**
   * Record usage for `principal` at `meterTimestampMs`.
   *
   * ## IMPORTANT — clock contract (ADR-017)
   * `meterTimestampMs` MUST be the meter's own clock value. It must NEVER be a
   * client-supplied timestamp (e.g. from a request header or signed payload).
   * Client timestamps must be passed separately as `clientTimestampMs` and are
   * stored for audit only — they do not influence window placement.
   *
   * - If the window containing `meterTimestampMs` is open: fast in-memory
   *   increment; no I/O.
   * - If the window is already sealed: late-arrival policy applies.
   *
   * @returns the running total for the window (from the in-memory counter),
   *          or `undefined` when the commit was redirected to the late ledger.
   */
  recordUsage(
    principal: string,
    meterTimestampMs: number,
    amount: number,
    clientTimestampMs?: number,
  ): number | undefined {
    if (amount <= 0) {
      const ws = windowBoundary(meterTimestampMs, this.durationMs);
      return this.counter.peek(principal, ws);
    }

    const ws = windowBoundary(meterTimestampMs, this.durationMs);

    if (this.closed.isSealed(principal, ws)) {
      // Late arrival — apply the configured policy.
      if (this.lateArrivalPolicy === 'reject') {
        throw new LateArrivalError(principal, ws, meterTimestampMs);
      }
      // redirect: record in the late ledger and return undefined so the caller
      // knows the write did not land in the primary counter.
      this.lateRecords.push({
        principal,
        originalWindowStart: ws,
        meterTimestampMs,
        clientTimestampMs,
        amount,
        redirectedAt: this.clock(),
        clockSource: this.clockSource,
      });
      return undefined;
    }

    return this.counter.increment(principal, meterTimestampMs, amount);
  }

  /**
   * Close the window that contains `windowStart` for `principal`.
   *
   * Drains the in-memory counter and seals the result. After this call:
   * - `closed.isSealed(principal, windowStart)` → `true`.
   * - Further `recordUsage` for this window will trigger the late-arrival
   *   policy.
   *
   * @returns the `ClosedWindowRecord` that was sealed.
   */
  closeWindow(principal: string, windowStart: number): ClosedWindowRecord {
    const totalUsed = this.counter.drain(principal, windowStart);
    const record: ClosedWindowRecord = {
      principal,
      windowStart,
      windowEnd: windowStart + this.durationMs,
      totalUsed,
      sealedAt: this.clock(),
      clockSource: this.clockSource,
    };
    this.closed.seal(record);
    return record;
  }

  /**
   * Close all windows that ended before `beforeMs` for `principal`.
   *
   * Convenience for settlement workers that want to sweep stale windows in
   * a single call rather than computing boundaries manually.
   */
  closeWindowsBefore(principal: string, beforeMs: number): ClosedWindowRecord[] {
    const sealed: ClosedWindowRecord[] = [];
    // Walk backwards from the boundary that contains `beforeMs - 1` to avoid
    // closing the currently-open window.
    let ws = windowBoundary(beforeMs - 1, this.durationMs);
    while (ws >= 0) {
      if (!this.closed.isSealed(principal, ws)) {
        const total = this.counter.peek(principal, ws);
        if (total > 0) {
          sealed.push(this.closeWindow(principal, ws));
        }
      }
      // Walk one window further back. We stop when there is no earlier data
      // for this principal in the in-memory counter.
      ws -= this.durationMs;
      if (ws < 0) break;
    }
    return sealed;
  }

  /** Current window start for wall-clock time. */
  currentWindowStart(): number {
    return windowBoundary(this.clock(), this.durationMs);
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a commit arrives for a window that has already been sealed and
 * the `lateArrivalPolicy` is `'reject'`.
 */
export class LateArrivalError extends Error {
  readonly principal: string;
  readonly windowStart: number;
  readonly timestampMs: number;

  constructor(principal: string, windowStart: number, timestampMs: number) {
    super(
      `Late arrival rejected: principal ${principal}, ` +
        `window ${windowLabel(windowStart)} (${windowStart}) is already sealed, ` +
        `commit timestamp ${new Date(timestampMs).toISOString()} (${timestampMs})`,
    );
    this.name = 'LateArrivalError';
    this.principal = principal;
    this.windowStart = windowStart;
    this.timestampMs = timestampMs;
  }
}

/**
 * Thrown when `ClosedWindowStore.seal()` is called for a
 * `(principal, windowStart)` that was already sealed.
 */
export class WindowAlreadySealedError extends Error {
  readonly principal: string;
  readonly windowStart: number;

  constructor(principal: string, windowStart: number) {
    super(
      `Window already sealed: principal ${principal}, ` +
        `window ${windowLabel(windowStart)} (${windowStart})`,
    );
    this.name = 'WindowAlreadySealedError';
    this.principal = principal;
    this.windowStart = windowStart;
  }
}
