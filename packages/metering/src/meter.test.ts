/**
 * Unit tests for the metering core (Issue #1440).
 *
 * Covers:
 *  - reserve / commit / release / read happy paths
 *  - cap enforcement (reserve throws when quota is insufficient)
 *  - idempotency of commit (same reservationId never double-charges)
 *  - reservation expiry sweep
 *  - overage warning thresholds surfaced on commit
 *  - degraded-mode activation via StaticDegradedModeEvaluator
 *  - degraded-mode: reserve succeeds even when quota is exceeded
 *  - DefaultDegradedModeEvaluator — direct port of Python algorithm tests
 *  - read returns correct snapshot (used, remaining, windowStart, degraded)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryMeter, InMemoryAllowanceStore } from './meter';
import {
  DefaultDegradedModeEvaluator,
  StaticDegradedModeEvaluator,
  type TrackerSnapshot,
} from './degraded';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClock(startMs = 1_700_000_000_000): { clock: () => number; advance: (ms: number) => void } {
  let now = startMs;
  return {
    clock: () => now,
    advance: (ms: number) => { now += ms; },
  };
}

// ---------------------------------------------------------------------------
// 1. Basic reserve / commit / release / read
// ---------------------------------------------------------------------------

describe('InMemoryMeter — basic operations', () => {
  let meter: InMemoryMeter;
  const { clock } = makeClock();

  beforeEach(() => {
    meter = new InMemoryMeter({ limits: { 'agent-1': 100 }, clock });
  });

  it('reserve returns a held reservation', () => {
    const rsv = meter.reserve('agent-1', 'llm:call', 10);
    expect(rsv.id).toMatch(/^rsv_/);
    expect(rsv.principal).toBe('agent-1');
    expect(rsv.route).toBe('llm:call');
    expect(rsv.upperBound).toBe(10);
    expect(rsv.degraded).toBe(false);
  });

  it('commit charges actual usage and releases the difference', () => {
    const rsv = meter.reserve('agent-1', 'llm:call', 10);
    const result = meter.commit(rsv.id, 7);
    expect(result.charged).toBe(7);
    expect(result.released).toBe(3);
  });

  it('release returns the full hold without charging', () => {
    const rsv = meter.reserve('agent-1', 'llm:call', 10);
    expect(() => meter.release(rsv.id)).not.toThrow();
    // After release, the 10 units should be available again.
    const rsv2 = meter.reserve('agent-1', 'llm:call', 10);
    expect(rsv2.id).not.toBe(rsv.id);
  });

  it('read returns current usage snapshot', () => {
    const rsv = meter.reserve('agent-1', 'llm:call', 10);
    meter.commit(rsv.id, 5);
    const reading = meter.read('agent-1');
    expect(reading.principal).toBe('agent-1');
    expect(reading.used).toBe(5);
    expect(reading.limit).toBe(100);
    expect(reading.remaining).toBe(95);
    expect(reading.degraded).toBe(false);
    expect(typeof reading.windowStart).toBe('number');
  });

  it('multiple commits accumulate in read', () => {
    const r1 = meter.reserve('agent-1', 'llm:call', 10);
    meter.commit(r1.id, 10);
    const r2 = meter.reserve('agent-1', 'llm:call', 20);
    meter.commit(r2.id, 15);
    const reading = meter.read('agent-1');
    expect(reading.used).toBe(25);
    expect(reading.remaining).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// 2. Cap enforcement
// ---------------------------------------------------------------------------

describe('InMemoryMeter — cap enforcement', () => {
  it('throws when upper-bound exceeds available quota', () => {
    const meter = new InMemoryMeter({ limits: { 'agent-1': 10 } });
    expect(() => meter.reserve('agent-1', 'llm:call', 11)).toThrow(/Insufficient allowance|available/i);
  });

  it('respects outstanding holds when computing available', () => {
    const meter = new InMemoryMeter({ limits: { 'agent-1': 10 } });
    meter.reserve('agent-1', 'llm:call', 8); // 8 of 10 held
    // Only 2 remain, so 3 should fail.
    expect(() => meter.reserve('agent-1', 'llm:call', 3)).toThrow();
  });

  it('after release the hold is returned and reserve succeeds', () => {
    const meter = new InMemoryMeter({ limits: { 'agent-1': 10 } });
    const rsv = meter.reserve('agent-1', 'llm:call', 10);
    meter.release(rsv.id);
    expect(() => meter.reserve('agent-1', 'llm:call', 10)).not.toThrow();
  });

  it('unlimited principal (no limit set) never throws', () => {
    const meter = new InMemoryMeter(); // no limits
    expect(() => meter.reserve('agent-unlimited', 'llm:call', 9999)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Idempotency — commit with same reservationId
// ---------------------------------------------------------------------------

describe('InMemoryMeter — idempotency', () => {
  it('second commit with same id does not double-charge', () => {
    const meter = new InMemoryMeter({ limits: { 'agent-1': 100 } });
    const rsv = meter.reserve('agent-1', 'llm:call', 10);
    meter.commit(rsv.id, 7);
    // The reservation is already committed; a second commit should throw (state != held).
    expect(() => meter.commit(rsv.id, 7)).toThrow(/not held/i);
    // Usage should still be 7, not 14.
    const reading = meter.read('agent-1');
    expect(reading.used).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 4. Reservation expiry sweep
// ---------------------------------------------------------------------------

describe('InMemoryMeter — expiry sweep', () => {
  it('expired reservations are swept and their quota released', () => {
    const { clock, advance } = makeClock();
    const meter = new InMemoryMeter({
      limits: { 'agent-1': 10 },
      clock,
      reservationTimeoutMs: 1_000,
    });
    meter.reserve('agent-1', 'llm:call', 10); // holds all 10 units

    // Advance past expiry.
    advance(2_000);

    // The sweeper runs on the next reserve; expired hold should be released.
    expect(() => meter.reserve('agent-1', 'llm:call', 10)).not.toThrow();
  });

  it('non-expired reservations remain valid after other reservations are swept', () => {
    const { clock, advance } = makeClock();
    const meter = new InMemoryMeter({
      limits: { 'agent-1': 100 },
      clock,
      reservationTimeoutMs: 5_000,
    });
    const rsv1 = meter.reserve('agent-1', 'llm:call', 20);
    advance(2_000); // before expiry
    const rsv2 = meter.reserve('agent-1', 'llm:call', 20);
    advance(4_000); // rsv1 expired (total 6s), rsv2 valid (total 4s)

    // rsv1 should be swept; committing it should throw.
    expect(() => meter.commit(rsv1.id, 5)).toThrow(/not held/i);
    // rsv2 should still be commitable.
    expect(() => meter.commit(rsv2.id, 10)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Overage warning thresholds
// ---------------------------------------------------------------------------

describe('InMemoryMeter — overage warning thresholds', () => {
  it('returns a warning when usage crosses 80% threshold', () => {
    const meter = new InMemoryMeter({ limits: { 'agent-1': 100 } });
    const rsv = meter.reserve('agent-1', 'llm:call', 80);
    const { warnings } = meter.commit(rsv.id, 80);
    // Should trigger the 80% threshold.
    expect(warnings.some((w) => /80/i.test(w) || /approaching/i.test(w))).toBe(true);
  });

  it('returns a warning when usage crosses 95% threshold', () => {
    const meter = new InMemoryMeter({ limits: { 'agent-1': 100 } });
    const rsv1 = meter.reserve('agent-1', 'llm:call', 95);
    const { warnings } = meter.commit(rsv1.id, 95);
    expect(warnings.some((w) => /95/i.test(w) || /near/i.test(w) || /nearly/i.test(w))).toBe(true);
  });

  it('no warning below 80% threshold', () => {
    const meter = new InMemoryMeter({ limits: { 'agent-1': 100 } });
    const rsv = meter.reserve('agent-1', 'llm:call', 70);
    const { warnings } = meter.commit(rsv.id, 70);
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Degraded mode — StaticDegradedModeEvaluator
// ---------------------------------------------------------------------------

describe('InMemoryMeter — degraded mode (static evaluator)', () => {
  it('reserve is tagged degraded: true when evaluator returns degraded', () => {
    const evaluator = new StaticDegradedModeEvaluator({
      degraded: true,
      servicesToLimit: ['openai'],
    });
    const meter = new InMemoryMeter({
      limits: { 'agent-1': 100 },
      degradedEvaluator: evaluator,
    });
    const rsv = meter.reserve('agent-1', 'llm:call', 10);
    expect(rsv.degraded).toBe(true);
  });

  it('read is tagged degraded: true when evaluator returns degraded', () => {
    const evaluator = new StaticDegradedModeEvaluator({
      degraded: true,
      servicesToLimit: [],
    });
    const meter = new InMemoryMeter({
      limits: { 'agent-1': 100 },
      degradedEvaluator: evaluator,
    });
    const reading = meter.read('agent-1');
    expect(reading.degraded).toBe(true);
  });

  it('reserve succeeds even when quota is fully exhausted in degraded mode', () => {
    const evaluator = new StaticDegradedModeEvaluator({
      degraded: true,
      servicesToLimit: ['openai'],
    });
    const meter = new InMemoryMeter({
      limits: { 'agent-1': 10 },
      degradedEvaluator: evaluator,
    });
    // Consume all 10 units.
    const rsv1 = meter.reserve('agent-1', 'llm:call', 10);
    meter.commit(rsv1.id, 10);
    // Now the ledger would reject, but degraded mode should allow.
    const rsv2 = meter.reserve('agent-1', 'llm:call', 5);
    expect(rsv2.degraded).toBe(true);
    expect(rsv2.id).toMatch(/rsv_deg_/);
  });

  it('commit succeeds for a degraded reservation', () => {
    const evaluator = new StaticDegradedModeEvaluator({
      degraded: true,
      servicesToLimit: [],
    });
    const meter = new InMemoryMeter({
      limits: { 'agent-1': 1 },
      degradedEvaluator: evaluator,
    });
    // Force a degraded reservation by exhausting quota.
    const rsv1 = meter.reserve('agent-1', 'llm:call', 1);
    meter.commit(rsv1.id, 1);
    const rsv2 = meter.reserve('agent-1', 'llm:call', 1);
    expect(rsv2.degraded).toBe(true);
    expect(() => meter.commit(rsv2.id, 1)).not.toThrow();
  });

  it('release on degraded reservation is a no-op (no throw)', () => {
    const evaluator = new StaticDegradedModeEvaluator({
      degraded: true,
      servicesToLimit: [],
    });
    const meter = new InMemoryMeter({
      limits: { 'agent-1': 1 },
      degradedEvaluator: evaluator,
    });
    const rsv1 = meter.reserve('agent-1', 'llm:call', 1);
    meter.commit(rsv1.id, 1);
    const rsv2 = meter.reserve('agent-1', 'llm:call', 1);
    expect(() => meter.release(rsv2.id)).not.toThrow();
  });

  it('normal mode: degraded: false when evaluator returns not degraded', () => {
    const evaluator = new StaticDegradedModeEvaluator({
      degraded: false,
      servicesToLimit: [],
    });
    const meter = new InMemoryMeter({
      limits: { 'agent-1': 100 },
      degradedEvaluator: evaluator,
    });
    const rsv = meter.reserve('agent-1', 'llm:call', 10);
    expect(rsv.degraded).toBe(false);
    const reading = meter.read('agent-1');
    expect(reading.degraded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. DefaultDegradedModeEvaluator — port of Python algorithm
// ---------------------------------------------------------------------------

describe('DefaultDegradedModeEvaluator — Python algorithm port', () => {
  function makeSnapshot(name: string, limit: number, used: number, throttleCount = 0): TrackerSnapshot {
    return { name, limit, used, throttleCount };
  }

  it('no degradation when all services are under thresholds', () => {
    const evaluator = new DefaultDegradedModeEvaluator(() => [
      makeSnapshot('a', 100, 50),
      makeSnapshot('b', 100, 30),
    ]);
    const { degraded, servicesToLimit } = evaluator.evaluate();
    expect(degraded).toBe(false);
    expect(servicesToLimit).toHaveLength(0);
  });

  it('global degraded flag when aggregate usage >= 90% (Python port test)', () => {
    // Python test: a=95, b=5 of 100 each = 100/200 = 50%, not degraded globally
    // Matches the Python test_degraded_mode_combination test from tests/test_tracker.py
    const evaluator = new DefaultDegradedModeEvaluator(() => [
      makeSnapshot('a', 100, 95),
      makeSnapshot('b', 100, 5),
    ]);
    const { degraded, servicesToLimit } = evaluator.evaluate();
    expect(degraded).toBe(false); // 100/200 = 50%, under 90%
    expect(servicesToLimit).toContain('a'); // 'a' is >= 95% of its own limit
  });

  it('global degraded flag when aggregate usage >= 90%', () => {
    const evaluator = new DefaultDegradedModeEvaluator(() => [
      makeSnapshot('a', 100, 90),
      makeSnapshot('b', 100, 91),
    ]);
    const { degraded } = evaluator.evaluate();
    expect(degraded).toBe(true); // (90 + 91) / 200 = 90.5% >= 90%
  });

  it('service flagged individually when >= 95% of its own limit', () => {
    const evaluator = new DefaultDegradedModeEvaluator(() => [
      makeSnapshot('svc-a', 100, 96),
      makeSnapshot('svc-b', 100, 80),
    ]);
    const { servicesToLimit } = evaluator.evaluate();
    expect(servicesToLimit).toContain('svc-a');
    expect(servicesToLimit).not.toContain('svc-b');
  });

  it('service flagged by throttle count', () => {
    const evaluator = new DefaultDegradedModeEvaluator(
      () => [makeSnapshot('svc-throttled', 100, 10, 3)],
      { throttleThreshold: 3 },
    );
    const { servicesToLimit } = evaluator.evaluate();
    expect(servicesToLimit).toContain('svc-throttled');
  });

  it('throttle below threshold does NOT flag the service', () => {
    const evaluator = new DefaultDegradedModeEvaluator(
      () => [makeSnapshot('svc', 100, 10, 2)],
      { throttleThreshold: 3 },
    );
    const { servicesToLimit } = evaluator.evaluate();
    expect(servicesToLimit).not.toContain('svc');
  });

  it('services_to_limit is the union of individually flagged + throttled (no dupes)', () => {
    const evaluator = new DefaultDegradedModeEvaluator(
      () => [
        makeSnapshot('svc-both', 100, 96, 3), // both individual and throttle
        makeSnapshot('svc-throttle-only', 100, 10, 5),
      ],
      { throttleThreshold: 3 },
    );
    const { servicesToLimit } = evaluator.evaluate();
    expect(servicesToLimit).toContain('svc-both');
    expect(servicesToLimit).toContain('svc-throttle-only');
    // No duplicates.
    expect(new Set(servicesToLimit).size).toBe(servicesToLimit.length);
  });

  it('empty tracker list returns not degraded with no services', () => {
    const evaluator = new DefaultDegradedModeEvaluator(() => []);
    const { degraded, servicesToLimit } = evaluator.evaluate();
    expect(degraded).toBe(false);
    expect(servicesToLimit).toHaveLength(0);
  });

  it('respects custom globalPercentThreshold', () => {
    const evaluator = new DefaultDegradedModeEvaluator(
      () => [makeSnapshot('a', 100, 75)],
      { globalPercentThreshold: 0.7 }, // 75% >= 70%
    );
    const { degraded } = evaluator.evaluate();
    expect(degraded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. InMemoryAllowanceStore — unit tests
// ---------------------------------------------------------------------------

describe('InMemoryAllowanceStore', () => {
  it('limitFor returns Infinity when no limit is set', () => {
    const store = new InMemoryAllowanceStore();
    expect(store.limitFor('unknown')).toBe(Infinity);
  });

  it('usedBy returns 0 before any usage is recorded', () => {
    const store = new InMemoryAllowanceStore();
    expect(store.usedBy('agent-1')).toBe(0);
  });

  it('recordUsage is idempotent per reservationId', () => {
    const store = new InMemoryAllowanceStore();
    store.setLimit('agent-1', 100);
    store.recordUsage('agent-1', 10, 'rsv-1');
    store.recordUsage('agent-1', 10, 'rsv-1'); // duplicate — should not double-count
    expect(store.usedBy('agent-1')).toBe(10);
  });

  it('recordUsage accumulates for different reservationIds', () => {
    const store = new InMemoryAllowanceStore();
    store.setLimit('agent-1', 100);
    store.recordUsage('agent-1', 10, 'rsv-1');
    store.recordUsage('agent-1', 20, 'rsv-2');
    expect(store.usedBy('agent-1')).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// 9. setLimit — dynamic limit update
// ---------------------------------------------------------------------------

describe('InMemoryMeter — dynamic setLimit', () => {
  it('setLimit raises the cap and allows a previously-rejected reservation', () => {
    const meter = new InMemoryMeter({ limits: { 'agent-1': 10 } });
    expect(() => meter.reserve('agent-1', 'llm:call', 11)).toThrow();
    meter.setLimit('agent-1', 50);
    expect(() => meter.reserve('agent-1', 'llm:call', 11)).not.toThrow();
  });

  it('read reflects the updated limit', () => {
    const meter = new InMemoryMeter({ limits: { 'agent-1': 10 } });
    meter.setLimit('agent-1', 200);
    const reading = meter.read('agent-1');
    expect(reading.limit).toBe(200);
  });
});
