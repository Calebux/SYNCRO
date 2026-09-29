/**
 * Deterministic clock-skew and window boundary tests (Issue #448).
 *
 * All tests inject a TestClock — no Date.now() is ever called.
 *
 * Boundary cases tested (ADR-017 requirement):
 *  1. Call 1 ms before boundary  → lands in window N.
 *  2. Call 1 ms after boundary   → lands in window N+1.
 *  3. Call exactly on boundary   → lands in window N+1 (boundary is window N+1's start).
 *
 * Skew guard cases:
 *  4. Client timestamp within MAX_SKEW_MS   → no throw, no alert.
 *  5. Client timestamp between MAX and HARD → alert callback fired, no throw.
 *  6. Client timestamp beyond HARD_SKEW_MS  → ClockSkewError thrown.
 *
 * Clock contract cases:
 *  7. Client timestamp does NOT shift window placement.
 *  8. ClosedWindowRecord.clockSource is 'test' when TestClock is used.
 *  9. LateRecord.clockSource is 'test' when TestClock is used.
 * 10. assertNoClientTimestamp throws immediately when called.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  TestClock,
  ClockSkewGuard,
  ClockSkewError,
  MAX_SKEW_MS,
  HARD_SKEW_MS,
  assertNoClientTimestamp,
  type SkewWarning,
} from './clock';
import { WindowStore, windowBoundary } from './window';
import { InMemoryMeter } from './meter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DURATION_MS = 60_000; // 1-minute windows for all tests

/**
 * A boundary-aligned start time: exactly a multiple of DURATION_MS.
 * 1_700_000_000_000 % 60_000 === 20_000 (NOT aligned), so we compute one:
 *   floor(1_700_000_000_000 / 60_000) * 60_000 = 1_699_999_980_000
 */
const WINDOW_N_START = Math.floor(1_700_000_000_000 / DURATION_MS) * DURATION_MS; // 1_699_999_980_000
const WINDOW_N_END   = WINDOW_N_START + DURATION_MS;                               // start of window N+1

// ---------------------------------------------------------------------------
// 1–3. Window boundary placement (deterministic, no Date.now())
// ---------------------------------------------------------------------------

describe('Window boundary placement — deterministic (ADR-017)', () => {
  it('1 ms before boundary: commit lands in window N', () => {
    const clock = new TestClock(WINDOW_N_START);
    const store = new WindowStore({ durationMs: DURATION_MS, clock: () => clock.now(), clockSource: 'test' });
    const principal = 'agent-boundary';

    // Advance to 1 ms before the end of window N.
    clock.set(WINDOW_N_END - 1);

    store.recordUsage(principal, clock.now(), 5);

    const reading = store.counter.peek(principal, WINDOW_N_START);
    expect(reading).toBe(5);

    // Window N+1 counter must be 0.
    const nextReading = store.counter.peek(principal, WINDOW_N_END);
    expect(nextReading).toBe(0);
  });

  it('1 ms after boundary: commit lands in window N+1', () => {
    const clock = new TestClock(WINDOW_N_START);
    const store = new WindowStore({ durationMs: DURATION_MS, clock: () => clock.now(), clockSource: 'test' });
    const principal = 'agent-boundary';

    // Advance to 1 ms after the boundary = first ms of window N+1.
    clock.set(WINDOW_N_END + 1);

    store.recordUsage(principal, clock.now(), 7);

    const readingN = store.counter.peek(principal, WINDOW_N_START);
    expect(readingN).toBe(0);

    const readingNplus1 = store.counter.peek(principal, WINDOW_N_END);
    expect(readingNplus1).toBe(7);
  });

  it('exactly on boundary: commit lands in window N+1 (boundary is N+1 start)', () => {
    // windowBoundary(t, d) = floor(t/d)*d
    // So WINDOW_N_END = floor(WINDOW_N_END / 60_000) * 60_000 = WINDOW_N_END itself.
    // That means it is the START of window N+1, not the end of window N.
    const clock = new TestClock(WINDOW_N_END);
    const store = new WindowStore({ durationMs: DURATION_MS, clock: () => clock.now(), clockSource: 'test' });
    const principal = 'agent-boundary';

    store.recordUsage(principal, clock.now(), 3);

    const readingN = store.counter.peek(principal, WINDOW_N_START);
    expect(readingN).toBe(0);

    const readingNplus1 = store.counter.peek(principal, WINDOW_N_END);
    expect(readingNplus1).toBe(3);

    // Sanity-check the math: boundary of WINDOW_N_END itself should be WINDOW_N_END.
    expect(windowBoundary(WINDOW_N_END, DURATION_MS)).toBe(WINDOW_N_END);
  });

  it('two commits 1 ms apart straddling the boundary land in separate windows', () => {
    const clock = new TestClock(WINDOW_N_END - 1);
    const store = new WindowStore({ durationMs: DURATION_MS, clock: () => clock.now(), clockSource: 'test' });
    const principal = 'agent-straddle';

    // First commit: 1 ms before boundary → window N.
    store.recordUsage(principal, clock.now(), 10);
    clock.advance(2); // cross the boundary
    // Second commit: 1 ms after boundary → window N+1.
    store.recordUsage(principal, clock.now(), 20);

    expect(store.counter.peek(principal, WINDOW_N_START)).toBe(10);
    expect(store.counter.peek(principal, WINDOW_N_END)).toBe(20);
  });

  it('InMemoryMeter: commit uses meter clock, not any caller-supplied value', () => {
    const clock = new TestClock(WINDOW_N_START);
    const meter = new InMemoryMeter({
      clock,
      windowDurationMs: DURATION_MS,
      limits: { 'agent-1': 1000 },
    });

    // Place the meter clock just before the boundary.
    clock.set(WINDOW_N_END - 1);
    const rsv = meter.reserve('agent-1', 'llm:call', 5);
    // Advance past the boundary before commit.
    clock.set(WINDOW_N_END + 1);
    meter.commit(rsv.id, 5);

    // The commit should land in window N+1 because the meter clock is now past the boundary.
    const reading = meter.read('agent-1');
    // windowStart should be WINDOW_N_END (= start of N+1).
    expect(reading.windowStart).toBe(WINDOW_N_END);
    expect(reading.used).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 4–6. ClockSkewGuard
// ---------------------------------------------------------------------------

describe('ClockSkewGuard (ADR-017)', () => {
  it('4. No alert and no throw when client timestamp is within MAX_SKEW_MS', () => {
    const clock = new TestClock(1_000_000);
    const alerts: SkewWarning[] = [];
    const guard = new ClockSkewGuard(clock, { onAlert: (w) => alerts.push(w) });

    // Client is MAX_SKEW_MS - 1 ms early.
    guard.check(clock.now() - (MAX_SKEW_MS - 1), 'test-ok');
    expect(alerts).toHaveLength(0);
  });

  it('5. Alert callback fires when skew is between MAX and HARD', () => {
    const clock = new TestClock(1_000_000);
    const alerts: SkewWarning[] = [];
    const guard = new ClockSkewGuard(clock, { onAlert: (w) => alerts.push(w) });

    const skew = MAX_SKEW_MS + 1_000; // between soft and hard limit
    guard.check(clock.now() - skew, 'test-warn');

    expect(alerts).toHaveLength(1);
    expect(alerts[0].driftMs).toBe(skew);
    expect(alerts[0].context).toBe('test-warn');
  });

  it('6. ClockSkewError thrown when skew exceeds HARD_SKEW_MS', () => {
    const clock = new TestClock(1_000_000);
    const guard = new ClockSkewGuard(clock);

    const clientTs = clock.now() - (HARD_SKEW_MS + 1_000);
    expect(() => guard.check(clientTs, 'test-hard')).toThrowError(ClockSkewError);
  });

  it('ClockSkewError carries the correct fields', () => {
    const clock = new TestClock(2_000_000);
    const guard = new ClockSkewGuard(clock);
    const clientTs = clock.now() + HARD_SKEW_MS + 500;

    let caught: ClockSkewError | null = null;
    try {
      guard.check(clientTs, 'test-fields');
    } catch (e) {
      if (e instanceof ClockSkewError) caught = e;
    }

    expect(caught).not.toBeNull();
    expect(caught!.clientTimestampMs).toBe(clientTs);
    expect(caught!.meterTimestampMs).toBe(clock.now());
    expect(caught!.driftMs).toBe(HARD_SKEW_MS + 500);
    expect(caught!.context).toBe('test-fields');
    expect(caught!.name).toBe('ClockSkewError');
  });

  it('checkAndGetMeterTime returns meter now after passing guard', () => {
    const clock = new TestClock(5_000_000);
    const guard = new ClockSkewGuard(clock);
    const meterNow = guard.checkAndGetMeterTime(clock.now() - 100, 'ok');
    expect(meterNow).toBe(clock.now());
  });

  it('checkAndGetMeterTime throws for hard skew', () => {
    const clock = new TestClock(5_000_000);
    const guard = new ClockSkewGuard(clock);
    expect(() =>
      guard.checkAndGetMeterTime(clock.now() - (HARD_SKEW_MS + 1), 'bad'),
    ).toThrowError(ClockSkewError);
  });
});

// ---------------------------------------------------------------------------
// 7. Client timestamp does NOT shift window placement
// ---------------------------------------------------------------------------

describe('Client timestamp isolation (ADR-017)', () => {
  it('7. Passing a client timestamp from a different window does not change placement', () => {
    const clock = new TestClock(WINDOW_N_START + 30_000); // middle of window N
    const store = new WindowStore({ durationMs: DURATION_MS, clock: () => clock.now(), clockSource: 'test' });
    const principal = 'agent-iso';

    // Client claims a timestamp in window N+1 (adversarial / misconfigured clock).
    const adversarialClientTs = WINDOW_N_END + 5_000;

    // recordUsage is called with the METER timestamp, not the client timestamp.
    // The client timestamp is passed for audit only.
    store.recordUsage(principal, clock.now(), 8, adversarialClientTs);

    // Usage must land in window N (meter clock is in window N).
    expect(store.counter.peek(principal, WINDOW_N_START)).toBe(8);
    // Window N+1 must be untouched.
    expect(store.counter.peek(principal, WINDOW_N_END)).toBe(0);
  });

  it('client timestamp stored in LateRecord for audit but window placement unchanged', () => {
    const clock = new TestClock(WINDOW_N_START + 10_000); // in window N
    const store = new WindowStore({
      durationMs: DURATION_MS,
      clock: () => clock.now(),
      clockSource: 'test',
      lateArrivalPolicy: 'redirect',
    });
    const principal = 'agent-late-audit';

    // Close window N.
    store.recordUsage(principal, clock.now(), 3);
    store.closeWindow(principal, WINDOW_N_START);

    // Now attempt a late commit into window N with an adversarial client ts.
    const clientTs = WINDOW_N_START + 1_000;
    const lateResult = store.recordUsage(principal, WINDOW_N_START + 500, 2, clientTs);

    expect(lateResult).toBeUndefined(); // redirected
    expect(store.lateRecords).toHaveLength(1);
    const lr = store.lateRecords[0];
    // Meter timestamp used for window placement.
    expect(lr.meterTimestampMs).toBe(WINDOW_N_START + 500);
    // Client timestamp stored for audit.
    expect(lr.clientTimestampMs).toBe(clientTs);
    expect(lr.clockSource).toBe('test');
  });
});

// ---------------------------------------------------------------------------
// 8–9. clockSource propagation
// ---------------------------------------------------------------------------

describe('clockSource propagation (ADR-017)', () => {
  it('8. ClosedWindowRecord.clockSource is "test" when TestClock is used', () => {
    const clock = new TestClock(WINDOW_N_START + 1_000);
    const store = new WindowStore({ durationMs: DURATION_MS, clock: () => clock.now(), clockSource: 'test' });
    const principal = 'agent-source';

    store.recordUsage(principal, clock.now(), 1);
    const record = store.closeWindow(principal, WINDOW_N_START);

    expect(record.clockSource).toBe('test');
  });

  it('9. LateRecord.clockSource is "test" when TestClock is used', () => {
    const clock = new TestClock(WINDOW_N_START + 1_000);
    const store = new WindowStore({
      durationMs: DURATION_MS,
      clock: () => clock.now(),
      clockSource: 'test',
      lateArrivalPolicy: 'redirect',
    });
    const principal = 'agent-late-source';

    store.recordUsage(principal, clock.now(), 1);
    store.closeWindow(principal, WINDOW_N_START);

    // Late commit into the now-sealed window.
    store.recordUsage(principal, WINDOW_N_START + 100, 1);
    expect(store.lateRecords[0].clockSource).toBe('test');
  });

  it('InMemoryMeter with TestClock propagates "test" clockSource to closed records', () => {
    const clock = new TestClock(WINDOW_N_START + 1_000);
    const meter = new InMemoryMeter({ clock, windowDurationMs: DURATION_MS });

    const rsv = meter.reserve('agent-cs', 'llm:call', 5);
    meter.commit(rsv.id, 5);

    // Close the window via the underlying store.
    const closed = (meter as any).windowStore.closeWindow('agent-cs', WINDOW_N_START);
    expect(closed.clockSource).toBe('test');
  });
});

// ---------------------------------------------------------------------------
// 10. assertNoClientTimestamp
// ---------------------------------------------------------------------------

describe('assertNoClientTimestamp (ADR-017)', () => {
  it('10. throws immediately with a clear message', () => {
    expect(() => assertNoClientTimestamp(1234567890, 'myFunction')).toThrow(
      /Client-supplied timestamp.*never be used.*myFunction.*ADR-017/,
    );
  });
});

// ---------------------------------------------------------------------------
// TestClock contract
// ---------------------------------------------------------------------------

describe('TestClock', () => {
  it('starts at the configured epoch', () => {
    const clock = new TestClock(42_000);
    expect(clock.now()).toBe(42_000);
    expect(clock.source).toBe('test');
  });

  it('advance moves the clock forward', () => {
    const clock = new TestClock(0);
    clock.advance(5_000);
    expect(clock.now()).toBe(5_000);
  });

  it('advance is cumulative', () => {
    const clock = new TestClock(0);
    clock.advance(1_000);
    clock.advance(2_000);
    expect(clock.now()).toBe(3_000);
  });

  it('set pins to an absolute value', () => {
    const clock = new TestClock(10_000);
    clock.set(99_000);
    expect(clock.now()).toBe(99_000);
  });

  it('advance throws for negative delta', () => {
    const clock = new TestClock(10_000);
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });
});
