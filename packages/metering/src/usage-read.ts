/**
 * Read path for usage queries (Issue #1443).
 *
 * Three consumers, three granularities:
 *
 * 1. **Admission** — needs the current window's consumed amount in < 10 ms at
 *    p99. This is served entirely from the in-memory `CurrentWindowCounter`
 *    with no I/O.
 *
 * 2. **Console** — needs hourly (or any-granularity) time series for charting.
 *    Served from `ClosedWindowStore.series()` which reads the immutable
 *    closed-window records.
 *
 * 3. **Settlement** — needs a closed window's total that is stable once the
 *    window closes. A late-arriving commit must not mutate a settled window.
 *    Served from `ClosedWindowStore.getTotal()` and must only be called after
 *    `WindowStore.closeWindow()`.
 *
 * All three paths are exposed as functions over a `WindowStore` instance so
 * they compose cleanly with the write path in `window.ts`.
 */

import {
  type ClosedWindowRecord,
  type WindowClock,
  type WindowStore,
  HOUR_MS,
  defaultClock,
  windowBoundary,
} from './window';

// ---------------------------------------------------------------------------
// 1. Current-window read — fast path for admission
// ---------------------------------------------------------------------------

export interface CurrentWindowResult {
  /** Epoch ms of the window boundary (floor to durationMs). */
  windowStart: number;
  /** Epoch ms of the window end (exclusive). */
  windowEnd: number;
  /** Usage accumulated so far in this window, from the in-memory counter. */
  used: number;
}

/**
 * Return the usage accumulated in the current window for `principal`.
 *
 * This reads entirely from the in-memory `CurrentWindowCounter` — no I/O, no
 * lock contention on a backing store. Target: < 10 ms at p99 under load.
 *
 * @param store  The `WindowStore` instance.
 * @param principal  Stable identifier for the agent / key / principal.
 */
export function readCurrentWindow(
  store: WindowStore,
  principal: string,
): CurrentWindowResult {
  const { windowStart, used } = store.counter.read(principal);
  return {
    windowStart,
    windowEnd: windowStart + store.durationMs,
    used,
  };
}

// ---------------------------------------------------------------------------
// 2. Closed-window series — console read path
// ---------------------------------------------------------------------------

export interface WindowSeriesOptions {
  /**
   * Return only windows whose `windowStart >= fromMs`.
   * Defaults to 24 hours ago when omitted.
   */
  fromMs?: number;
  /**
   * Return only windows whose `windowStart < toMs`.
   * Defaults to `Date.now()` when omitted.
   */
  toMs?: number;
  /** Injected clock. Defaults to `Date.now`. */
  clock?: WindowClock;
}

/**
 * Return the closed-window series for `principal` within the given time range,
 * sorted by `windowStart` ascending.
 *
 * Only includes windows that have been explicitly closed via
 * `WindowStore.closeWindow()`. Open (not-yet-sealed) windows are not included;
 * use `readCurrentWindow` for the live running total.
 */
export function readWindowSeries(
  store: WindowStore,
  principal: string,
  options: WindowSeriesOptions = {},
): ClosedWindowRecord[] {
  const clock = options.clock ?? defaultClock;
  const now = clock();
  const fromMs = options.fromMs ?? now - 24 * HOUR_MS;
  const toMs = options.toMs ?? now;

  return store.closed
    .series(principal)
    .filter((r) => r.windowStart >= fromMs && r.windowStart < toMs);
}

// ---------------------------------------------------------------------------
// 3. Settlement read — stable closed-window total
// ---------------------------------------------------------------------------

export interface SettlementReadResult {
  principal: string;
  windowStart: number;
  windowEnd: number;
  totalUsed: number;
  /** Epoch ms when the window was sealed — i.e., when the total became stable. */
  sealedAt: number;
  /**
   * Whether any late-arriving commits landed in the late ledger for this
   * window. Settlement SHOULD inspect `store.lateRecords` when this is `true`.
   */
  hasLateArrivals: boolean;
}

/**
 * Read the settled total for a specific closed window.
 *
 * Returns `undefined` when the window has not been sealed yet — the caller
 * should call `WindowStore.closeWindow()` first and then read. This makes the
 * contract explicit: settlement may only read windows that have been closed.
 *
 * The returned total is guaranteed stable: `ClosedWindowStore` is immutable
 * once sealed, so this value cannot change after the first call returns it.
 */
export function readSettledWindow(
  store: WindowStore,
  principal: string,
  windowStart: number,
): SettlementReadResult | undefined {
  const record = store.closed.getTotal(principal, windowStart);
  if (!record) return undefined;

  const hasLateArrivals = store.lateRecords.some(
    (lr) => lr.principal === principal && lr.originalWindowStart === windowStart,
  );

  return {
    principal: record.principal,
    windowStart: record.windowStart,
    windowEnd: record.windowEnd,
    totalUsed: record.totalUsed,
    sealedAt: record.sealedAt,
    hasLateArrivals,
  };
}

// ---------------------------------------------------------------------------
// 4. Aggregate helpers — multi-window totals (used by reporting)
// ---------------------------------------------------------------------------

export interface AggregateUsageOptions {
  /** Start of the range (inclusive). */
  fromMs: number;
  /** End of the range (exclusive). */
  toMs: number;
  /** Injected clock. Defaults to `Date.now`. */
  clock?: WindowClock;
}

/**
 * Sum the total usage for `principal` across all closed windows in the given
 * time range. Excludes the current open window.
 */
export function aggregateClosedUsage(
  store: WindowStore,
  principal: string,
  options: AggregateUsageOptions,
): number {
  const series = readWindowSeries(store, principal, {
    fromMs: options.fromMs,
    toMs: options.toMs,
    clock: options.clock,
  });
  return series.reduce((sum, r) => sum + r.totalUsed, 0);
}

// ---------------------------------------------------------------------------
// 5. Admission gate — combines current window + closed totals
// ---------------------------------------------------------------------------

export interface AdmissionResult {
  /** Usage in the current (open) window, from the in-memory counter. */
  currentUsed: number;
  /** Window boundary of the current window. */
  windowStart: number;
  /** Sum of closed-window usage in the look-back period, if requested. */
  historicalUsed?: number;
  /** Whether the in-flight request fits within `limit`. */
  admitted: boolean;
}

/**
 * Gate an admission decision for `principal` requesting `amount` units.
 *
 * - Reads the current in-memory counter (sub-10 ms).
 * - Optionally aggregates closed windows for a rolling look-back.
 * - Returns `admitted: false` when `currentUsed + amount > limit`.
 *
 * The hot path (no historical look-back) is a single Map lookup.
 */
export function admissionRead(
  store: WindowStore,
  principal: string,
  amount: number,
  limit: number,
  includeHistoricalMs?: number,
): AdmissionResult {
  const current = readCurrentWindow(store, principal);
  let historicalUsed: number | undefined;

  if (includeHistoricalMs !== undefined && includeHistoricalMs > 0) {
    // Use the store's own counter.read to get the correct current window start
    // (which uses the store's injected clock), then range back from there.
    const { windowStart } = store.counter.read(principal);
    historicalUsed = aggregateClosedUsage(store, principal, {
      fromMs: windowStart - includeHistoricalMs,
      toMs: windowStart,
    });
  }

  const effective = current.used + (historicalUsed ?? 0);
  return {
    currentUsed: current.used,
    windowStart: current.windowStart,
    historicalUsed,
    admitted: effective + amount <= limit,
  };
}

// ---------------------------------------------------------------------------
// 6. Window boundary utilities exported for callers that need them
// ---------------------------------------------------------------------------

export { windowBoundary, windowLabel, HOUR_MS, MINUTE_MS, DAY_MS } from './window';
