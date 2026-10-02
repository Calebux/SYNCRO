/**
 * Tests for aggregation windows and the usage read path (Issue #1443).
 *
 * Acceptance criteria:
 * AC1 — Window boundaries are explicit and deterministic (not implied by
 *        insertion time).
 * AC2 — Admission reads are served from the in-memory counter; no I/O.
 * AC3 — Closed-window reads are stable once the window closes — a late-arriving
 *        commit must not mutate a settled window.
 * AC4 — Late-arriving commits are handled according to the configured policy:
 *        'redirect' records them in the late ledger; 'reject' throws.
 * AC5 — Admission reads are < 10 ms at p99 (measured in the performance test).
 * AC6 — A settled window is provably immutable (sealing twice throws).
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  windowBoundary,
  windowLabel,
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  CurrentWindowCounter,
  ClosedWindowStore,
  WindowStore,
  LateArrivalError,
  WindowAlreadySealedError,
} from './window';

import {
  readCurrentWindow,
  readWindowSeries,
  readSettledWindow,
  aggregateClosedUsage,
  admissionRead,
} from './usage-read';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Synthetic clock: returns whatever value you assign to `t`. */
function makeClock(initial = 0): { t: number; clock: () => number } {
  const state = { t: initial };
  return { ...state, clock: () => state.t };
}

function store(durationMs = MINUTE_MS, clock?: () => number): WindowStore {
  return new WindowStore({ durationMs, clock, lateArrivalPolicy: 'redirect' });
}

function storeReject(durationMs = MINUTE_MS, clock?: () => number): WindowStore {
  return new WindowStore({ durationMs, clock, lateArrivalPolicy: 'reject' });
}

// ---------------------------------------------------------------------------
// AC1 — Window boundary math
// ---------------------------------------------------------------------------

describe('windowBoundary', () => {
  // Pick a base that IS a minute boundary:
  //   1_699_999_980_000 / 60_000 = 28_333_333 exactly
  const BASE_MINUTE = 1_699_999_980_000; // a real minute boundary

  it('aligns to the start of the containing minute window', () => {
    // BASE_MINUTE + 39_999 ms is still inside the same minute window.
    expect(windowBoundary(BASE_MINUTE + 39_999, MINUTE_MS)).toBe(BASE_MINUTE);
  });

  it('returns the boundary itself when timestamp is exactly on a boundary', () => {
    expect(windowBoundary(BASE_MINUTE, MINUTE_MS)).toBe(BASE_MINUTE);
  });

  it('aligns to the start of the containing hour window', () => {
    // Pick a base that is an hour boundary: floor to HOUR_MS.
    const hourBase = Math.floor(BASE_MINUTE / HOUR_MS) * HOUR_MS;
    const midHour = hourBase + 1_800_000; // 30 min into the hour
    expect(windowBoundary(midHour, HOUR_MS)).toBe(hourBase);
  });

  it('different timestamps in the same window return the same boundary', () => {
    const a = BASE_MINUTE + 1;
    const b = BASE_MINUTE + 59_999;
    expect(windowBoundary(a, MINUTE_MS)).toBe(windowBoundary(b, MINUTE_MS));
  });

  it('throws for non-positive durationMs', () => {
    expect(() => windowBoundary(0, 0)).toThrow(RangeError);
    expect(() => windowBoundary(0, -1)).toThrow(RangeError);
  });

  it('produces ISO strings via windowLabel', () => {
    const ts = windowBoundary(Date.now(), HOUR_MS);
    expect(windowLabel(ts)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// CurrentWindowCounter
// ---------------------------------------------------------------------------

describe('CurrentWindowCounter', () => {
  it('starts at 0 for every principal', () => {
    const c = new CurrentWindowCounter(MINUTE_MS);
    const { used } = c.read('alice');
    expect(used).toBe(0);
  });

  it('increments return running totals', () => {
    const { t, clock } = makeClock(1_700_000_010_000);
    const c = new CurrentWindowCounter(MINUTE_MS, clock);
    const ws = windowBoundary(t, MINUTE_MS);

    c.increment('alice', t, 5);
    c.increment('alice', t, 3);
    expect(c.peek('alice', ws)).toBe(8);
  });

  it('ignores zero / negative amounts', () => {
    const { t, clock } = makeClock(1_700_000_010_000);
    const c = new CurrentWindowCounter(MINUTE_MS, clock);
    const ws = windowBoundary(t, MINUTE_MS);

    c.increment('alice', t, 0);
    c.increment('alice', t, -5);
    expect(c.peek('alice', ws)).toBe(0);
  });

  it('different principals are isolated', () => {
    const { t, clock } = makeClock(1_700_000_010_000);
    const c = new CurrentWindowCounter(MINUTE_MS, clock);

    c.increment('alice', t, 7);
    c.increment('bob', t, 3);

    expect(c.peek('alice', windowBoundary(t, MINUTE_MS))).toBe(7);
    expect(c.peek('bob', windowBoundary(t, MINUTE_MS))).toBe(3);
  });

  it('drain clears the counter and returns the total', () => {
    const { t, clock } = makeClock(1_700_000_010_000);
    const c = new CurrentWindowCounter(MINUTE_MS, clock);
    const ws = windowBoundary(t, MINUTE_MS);

    c.increment('alice', t, 10);
    const total = c.drain('alice', ws);
    expect(total).toBe(10);
    expect(c.peek('alice', ws)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ClosedWindowStore — AC3 + AC6
// ---------------------------------------------------------------------------

describe('ClosedWindowStore', () => {
  it('seals a record and returns it via getTotal', () => {
    const cs = new ClosedWindowStore();
    const record = {
      principal: 'alice',
      windowStart: 1_700_000_000_000,
      windowEnd: 1_700_000_060_000,
      totalUsed: 42,
      sealedAt: Date.now(),
    };
    cs.seal(record);
    expect(cs.getTotal('alice', 1_700_000_000_000)).toMatchObject({ totalUsed: 42 });
  });

  it('AC6 — sealing the same window twice throws WindowAlreadySealedError', () => {
    const cs = new ClosedWindowStore();
    const record = {
      principal: 'alice',
      windowStart: 1_700_000_000_000,
      windowEnd: 1_700_000_060_000,
      totalUsed: 10,
      sealedAt: Date.now(),
    };
    cs.seal(record);
    expect(() => cs.seal({ ...record, totalUsed: 99 })).toThrow(WindowAlreadySealedError);
  });

  it('AC3 — the sealed record is frozen (mutations are ignored in strict mode)', () => {
    const cs = new ClosedWindowStore();
    const record = {
      principal: 'alice',
      windowStart: 1_700_000_000_000,
      windowEnd: 1_700_000_060_000,
      totalUsed: 10,
      sealedAt: 0,
    };
    cs.seal(record);
    const stored = cs.getTotal('alice', record.windowStart)!;
    expect(() => {
      // Strict mode: assigning to a frozen object throws TypeError
      (stored as { totalUsed: number }).totalUsed = 999;
    }).toThrow(TypeError);
    expect(stored.totalUsed).toBe(10);
  });

  it('returns undefined for an unsealed window', () => {
    const cs = new ClosedWindowStore();
    expect(cs.getTotal('alice', 0)).toBeUndefined();
  });

  it('series returns records sorted by windowStart ascending', () => {
    const cs = new ClosedWindowStore();
    const make = (ws: number) => ({
      principal: 'alice',
      windowStart: ws,
      windowEnd: ws + MINUTE_MS,
      totalUsed: ws,
      sealedAt: 0,
    });
    cs.seal(make(MINUTE_MS * 3));
    cs.seal(make(MINUTE_MS * 1));
    cs.seal(make(MINUTE_MS * 2));

    const s = cs.series('alice');
    expect(s.map((r) => r.windowStart)).toEqual([
      MINUTE_MS * 1,
      MINUTE_MS * 2,
      MINUTE_MS * 3,
    ]);
  });
});

// ---------------------------------------------------------------------------
// WindowStore — write path
// ---------------------------------------------------------------------------

describe('WindowStore', () => {
  it('recordUsage increments the in-memory counter', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 5);
    expect(s.counter.peek('alice', ws)).toBe(5);
  });

  it('closeWindow drains the counter and seals the record', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 10);
    const record = s.closeWindow('alice', ws);

    expect(record.totalUsed).toBe(10);
    expect(s.closed.isSealed('alice', ws)).toBe(true);
    // Counter is drained
    expect(s.counter.peek('alice', ws)).toBe(0);
  });

  it('AC3 — late commit via redirect does not mutate the sealed window', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 10);
    s.closeWindow('alice', ws);

    // Late commit (same window, after sealing)
    const result = s.recordUsage('alice', cs.t, 99);

    expect(result).toBeUndefined(); // redirected
    expect(s.closed.getTotal('alice', ws)!.totalUsed).toBe(10); // immutable
    expect(s.lateRecords).toHaveLength(1);
    expect(s.lateRecords[0].amount).toBe(99);
  });

  it('AC4 — reject policy throws LateArrivalError', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = storeReject(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 5);
    s.closeWindow('alice', ws);

    expect(() => s.recordUsage('alice', cs.t, 1)).toThrow(LateArrivalError);
    // The closed window is still intact
    expect(s.closed.getTotal('alice', ws)!.totalUsed).toBe(5);
  });

  it('closeWindow is idempotent in terms of drainage but throws on double-seal', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 5);
    s.closeWindow('alice', ws);
    // No data in counter after drain, so this would seal with totalUsed=0 BUT
    // the store should throw on the second seal attempt.
    expect(() => s.closeWindow('alice', ws)).toThrow(WindowAlreadySealedError);
  });

  it('currentWindowStart returns the floor for wall-clock time', () => {
    const cs = makeClock(1_700_000_059_999);
    const s = store(MINUTE_MS, cs.clock);
    expect(s.currentWindowStart()).toBe(windowBoundary(cs.t, MINUTE_MS));
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC5 — readCurrentWindow: fast path / admission performance
// ---------------------------------------------------------------------------

describe('readCurrentWindow', () => {
  it('returns the current window usage from the in-memory counter', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    s.recordUsage('alice', cs.t, 7);

    const result = readCurrentWindow(s, 'alice');
    expect(result.used).toBe(7);
    expect(result.windowStart).toBe(windowBoundary(cs.t, MINUTE_MS));
  });

  it('returns 0 for a principal with no usage yet', () => {
    const s = store();
    const result = readCurrentWindow(s, 'nobody');
    expect(result.used).toBe(0);
  });

  it('AC5 — 10 000 consecutive reads complete in < 100 ms (< 10 µs each)', () => {
    const s = store();
    s.recordUsage('alice', Date.now(), 1);

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      readCurrentWindow(s, 'alice');
    }
    const elapsed = performance.now() - start;

    // 10 000 reads in < 100 ms means < 10 µs per read — trivially under the
    // < 10 ms p99 target even for a single read.
    expect(elapsed).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// readWindowSeries
// ---------------------------------------------------------------------------

describe('readWindowSeries', () => {
  it('returns only closed windows in the requested range', () => {
    const base = 1_700_000_000_000;
    const s = store(HOUR_MS);

    // Close three consecutive hourly windows.
    s.recordUsage('alice', base + 0 * HOUR_MS + 1, 10);
    s.closeWindow('alice', windowBoundary(base, HOUR_MS));

    s.recordUsage('alice', base + 1 * HOUR_MS + 1, 20);
    s.closeWindow('alice', windowBoundary(base + 1 * HOUR_MS, HOUR_MS));

    s.recordUsage('alice', base + 2 * HOUR_MS + 1, 30);
    s.closeWindow('alice', windowBoundary(base + 2 * HOUR_MS, HOUR_MS));

    const w0 = windowBoundary(base, HOUR_MS);
    const w1 = windowBoundary(base + 1 * HOUR_MS, HOUR_MS);
    const w2 = windowBoundary(base + 2 * HOUR_MS, HOUR_MS);

    // Request only windows 1 and 2.
    const series = readWindowSeries(s, 'alice', {
      fromMs: w1,
      toMs: w2 + HOUR_MS,
    });

    expect(series).toHaveLength(2);
    expect(series[0].windowStart).toBe(w1);
    expect(series[1].windowStart).toBe(w2);
  });

  it('returns an empty array when no windows are closed', () => {
    const s = store();
    expect(readWindowSeries(s, 'nobody')).toEqual([]);
  });

  it('excludes the open (current) window', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    s.recordUsage('alice', cs.t, 5); // open window — not yet closed

    const series = readWindowSeries(s, 'alice', {
      fromMs: 0,
      toMs: cs.t + MINUTE_MS,
      clock: cs.clock,
    });
    expect(series).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// readSettledWindow
// ---------------------------------------------------------------------------

describe('readSettledWindow', () => {
  it('returns undefined for an unsealed window', () => {
    const s = store();
    expect(readSettledWindow(s, 'alice', 0)).toBeUndefined();
  });

  it('returns the settled total and metadata', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 42);
    s.closeWindow('alice', ws);

    const result = readSettledWindow(s, 'alice', ws);
    expect(result).toBeDefined();
    expect(result!.totalUsed).toBe(42);
    expect(result!.windowStart).toBe(ws);
    expect(result!.windowEnd).toBe(ws + MINUTE_MS);
    expect(result!.hasLateArrivals).toBe(false);
  });

  it('AC3 — calling readSettledWindow twice returns the same value', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 15);
    s.closeWindow('alice', ws);

    const r1 = readSettledWindow(s, 'alice', ws);
    const r2 = readSettledWindow(s, 'alice', ws);
    expect(r1!.totalUsed).toBe(r2!.totalUsed);
  });

  it('hasLateArrivals is true when a redirect was recorded for that window', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 5);
    s.closeWindow('alice', ws);

    // Redirect a late commit.
    s.recordUsage('alice', cs.t, 3); // same window, already sealed → late

    const result = readSettledWindow(s, 'alice', ws)!;
    expect(result.hasLateArrivals).toBe(true);
    expect(result.totalUsed).toBe(5); // still immutable
  });
});

// ---------------------------------------------------------------------------
// aggregateClosedUsage
// ---------------------------------------------------------------------------

describe('aggregateClosedUsage', () => {
  it('sums usage across the requested closed windows', () => {
    // Use explicit hour boundaries so the arithmetic is unambiguous.
    const w0 = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - 2 * HOUR_MS;
    const w1 = w0 + HOUR_MS;
    const s = store(HOUR_MS);

    s.recordUsage('alice', w0 + 1, 10);
    s.closeWindow('alice', w0);

    s.recordUsage('alice', w1 + 1, 20);
    s.closeWindow('alice', w1);

    const total = aggregateClosedUsage(s, 'alice', {
      fromMs: w0,
      toMs: w1 + HOUR_MS,
    });
    expect(total).toBe(30);
  });

  it('returns 0 when no windows are in range', () => {
    const s = store();
    expect(aggregateClosedUsage(s, 'nobody', { fromMs: 0, toMs: DAY_MS })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// admissionRead
// ---------------------------------------------------------------------------

describe('admissionRead', () => {
  it('admits a request within the limit', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    s.recordUsage('alice', cs.t, 40);

    const result = admissionRead(s, 'alice', 50, 100);
    expect(result.admitted).toBe(true);
    expect(result.currentUsed).toBe(40);
  });

  it('rejects a request that would exceed the limit', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    s.recordUsage('alice', cs.t, 80);

    const result = admissionRead(s, 'alice', 25, 100);
    expect(result.admitted).toBe(false);
  });

  it('admits when currentUsed + amount === limit (boundary inclusive)', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    s.recordUsage('alice', cs.t, 50);

    const result = admissionRead(s, 'alice', 50, 100);
    expect(result.admitted).toBe(true);
  });

  it('does not include historical when includeHistoricalMs is undefined', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);

    const result = admissionRead(s, 'alice', 1, 100);
    expect(result.historicalUsed).toBeUndefined();
  });

  it('returns historicalUsed when includeHistoricalMs is provided', () => {
    const base = 1_700_000_000_000;
    const cs = makeClock(base + MINUTE_MS + 1); // second window
    const s = store(MINUTE_MS, cs.clock);

    // Close the first window with 30 usage.
    s.recordUsage('alice', base + 1, 30);
    s.closeWindow('alice', windowBoundary(base, MINUTE_MS));

    // Now in the second window with 5 usage.
    s.recordUsage('alice', cs.t, 5);

    const result = admissionRead(s, 'alice', 10, 200, 2 * MINUTE_MS);
    expect(result.historicalUsed).toBe(30);
    expect(result.currentUsed).toBe(5);
    expect(result.admitted).toBe(true);
  });

  it('AC5 performance — 50 000 admission reads in < 500 ms', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    s.recordUsage('alice', cs.t, 1);

    const start = performance.now();
    for (let i = 0; i < 50_000; i++) {
      admissionRead(s, 'alice', 1, 1_000_000);
    }
    const elapsed = performance.now() - start;

    // < 500 ms for 50 000 reads means < 10 µs per read on average —
    // comfortably under the < 10 ms p99 target.
    expect(elapsed).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// Late-arrival edge cases
// ---------------------------------------------------------------------------

describe('late-arrival policy', () => {
  it('redirect — multiple late commits accumulate in lateRecords', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 5);
    s.closeWindow('alice', ws);

    s.recordUsage('alice', cs.t, 1);
    s.recordUsage('alice', cs.t, 2);
    s.recordUsage('alice', cs.t, 3);

    expect(s.lateRecords).toHaveLength(3);
    const total = s.lateRecords.reduce((sum, r) => sum + r.amount, 0);
    expect(total).toBe(6);
  });

  it('redirect — late records from different principals are isolated', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = store(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.recordUsage('alice', cs.t, 5);
    s.recordUsage('bob', cs.t, 3);
    s.closeWindow('alice', ws);
    s.closeWindow('bob', ws);

    s.recordUsage('alice', cs.t, 99);
    s.recordUsage('bob', cs.t, 77);

    expect(s.lateRecords.filter((r) => r.principal === 'alice')).toHaveLength(1);
    expect(s.lateRecords.filter((r) => r.principal === 'bob')).toHaveLength(1);
    expect(s.closed.getTotal('alice', ws)!.totalUsed).toBe(5);
    expect(s.closed.getTotal('bob', ws)!.totalUsed).toBe(3);
  });

  it('reject — LateArrivalError carries principal and windowStart', () => {
    const cs = makeClock(1_700_000_010_000);
    const s = storeReject(MINUTE_MS, cs.clock);
    const ws = windowBoundary(cs.t, MINUTE_MS);

    s.closeWindow('alice', ws);

    try {
      s.recordUsage('alice', cs.t, 5);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LateArrivalError);
      expect((err as LateArrivalError).principal).toBe('alice');
      expect((err as LateArrivalError).windowStart).toBe(ws);
    }
  });
});

// ---------------------------------------------------------------------------
// Window duration variants (minute, hour, day)
// ---------------------------------------------------------------------------

describe('window duration variants', () => {
  it.each([
    ['minute', MINUTE_MS],
    ['hour', HOUR_MS],
    ['day', DAY_MS],
  ])('%s-duration window closes and is immutable', (_name, duration) => {
    const base = 1_700_000_000_000;
    const cs = makeClock(base + 1);
    const s = store(duration, cs.clock);
    const ws = windowBoundary(base, duration);

    s.recordUsage('alice', base + 1, 100);
    s.closeWindow('alice', ws);

    expect(s.closed.isSealed('alice', ws)).toBe(true);
    expect(s.closed.getTotal('alice', ws)!.totalUsed).toBe(100);
    expect(() => s.recordUsage('alice', base + 1, 1)).not.toThrow(); // redirect, no throw
    expect(s.closed.getTotal('alice', ws)!.totalUsed).toBe(100); // immutable
  });
});
