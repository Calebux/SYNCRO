/**
 * Unit tests for degraded-mode admission (Issue #1444).
 *
 * Covers:
 *  - healthy store: admitted without a hold, nothing logged
 *  - fail-open: admitted while degraded, settled calls land in the durable log
 *  - fail-closed: refused with `fail_closed`
 *  - bounded fail-open: pending holds count against the ceiling, rollback
 *    returns headroom, settle consumes the amount actually served
 *  - ceiling exhaustion flips a provider to refusing, once, with an event
 *  - per-provider policies are independent
 *  - exactly one `entered` and one `exited` event per outage
 *  - exposure budget resets when a new outage starts
 *  - console snapshot
 *  - file log durability + torn-tail tolerance + reconciliation dedupe
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DegradedAdmissionController,
  DEFAULT_DEGRADED_POLICY,
  type DegradedEvent,
  type DegradedPolicy,
} from './degraded-admission';
import {
  FileDegradedUsageLog,
  InMemoryDegradedUsageLog,
  dedupeDegradedUsage,
  type DegradedUsageRecord,
} from './degraded-log';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function record(overrides: Partial<DegradedUsageRecord> = {}): Omit<DegradedUsageRecord, 'outageId'> {
  return {
    id: 'rcpt_1',
    providerId: 'prov_a',
    principal: 'agent-1',
    route: 'GET:/v1/search',
    reservationId: 'rsv_1',
    receiptId: 'rcpt_1',
    units: 1,
    amount: 4,
    meteredAt: '2026-10-06T00:00:00.000Z',
    ...overrides,
  };
}

interface Harness {
  controller: DegradedAdmissionController;
  log: InMemoryDegradedUsageLog;
  events: DegradedEvent[];
  setAvailable: (value: boolean) => void;
  advance: (ms: number) => void;
}

function makeHarness(
  options: {
    defaultPolicy?: Partial<DegradedPolicy>;
    policies?: Record<string, Partial<DegradedPolicy>>;
    initiallyAvailable?: boolean;
  } = {},
): Harness {
  const { clock, advance } = makeClock();
  const log = new InMemoryDegradedUsageLog();
  const events: DegradedEvent[] = [];
  let available = options.initiallyAvailable ?? true;

  const controller = new DegradedAdmissionController({
    isCounterStoreAvailable: () => available,
    log,
    clock,
    defaultPolicy: options.defaultPolicy,
    policies: options.policies,
    onEvent: (event) => events.push(event),
  });

  return { controller, log, events, setAvailable: (value) => { available = value; }, advance };
}

// ---------------------------------------------------------------------------
// 1. Healthy path
// ---------------------------------------------------------------------------

describe('DegradedAdmissionController — counter store healthy', () => {
  it('admits without a hold and records nothing', () => {
    const { controller, log } = makeHarness();

    const decision = controller.admit('prov_a', 10);

    expect(decision.admitted).toBe(true);
    expect(decision.degraded).toBe(false);
    expect(decision.reason).toBe('counter_store_available');
    expect(decision.holdId).toBeNull();
    expect(controller.isDegraded()).toBe(false);

    // Nothing to reconcile: no hold to settle, no log entry.
    controller.settle(decision.holdId, record());
    expect(log.read()).toHaveLength(0);
  });

  it('does not fire transition events while the store stays healthy', () => {
    const { controller, events } = makeHarness();
    controller.admit('prov_a', 1);
    controller.admit('prov_a', 1);
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Fail open
// ---------------------------------------------------------------------------

describe('DegradedAdmissionController — fail open', () => {
  it('admits while degraded and settles into the durable log', () => {
    const { controller, log, setAvailable } = makeHarness();
    setAvailable(false);

    const decision = controller.admit('prov_a', 4);
    expect(decision.admitted).toBe(true);
    expect(decision.degraded).toBe(true);
    expect(decision.reason).toBe('fail_open');
    expect(decision.holdId).toBeTruthy();

    controller.settle(decision.holdId, record({ amount: 4 }));

    const entries = log.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe(4);
    expect(entries[0].receiptId).toBe('rcpt_1');
    expect(entries[0].outageId).toBe(controller.snapshot().outageId);
  });

  it('records the call even when it served less than the held exposure', () => {
    const { controller, log, setAvailable } = makeHarness({
      defaultPolicy: { exposureCeiling: 100 },
    });
    setAvailable(false);

    const decision = controller.admit('prov_a', 100); // worst-case hold
    controller.settle(decision.holdId, record({ amount: 6 })); // actual charge

    const status = controller.snapshot().providers.find((p) => p.providerId === 'prov_a');
    expect(status?.exposureUsed).toBe(6);
    expect(status?.exposurePending).toBe(0);
    expect(log.read()[0].amount).toBe(6);
  });

  it('rollback returns headroom and writes nothing', () => {
    const { controller, log, setAvailable } = makeHarness({
      defaultPolicy: { exposureCeiling: 10 },
    });
    setAvailable(false);

    const decision = controller.admit('prov_a', 10);
    controller.rollback(decision.holdId);

    const status = controller.snapshot().providers.find((p) => p.providerId === 'prov_a');
    expect(status?.exposurePending).toBe(0);
    expect(status?.exposureUsed).toBe(0);
    expect(log.read()).toHaveLength(0);

    // The ceiling is whole again: the next call fits.
    expect(controller.admit('prov_a', 10).admitted).toBe(true);
  });

  it('settle and rollback on a null hold are no-ops', () => {
    const { controller, log, setAvailable } = makeHarness();
    setAvailable(false);
    expect(() => {
      controller.settle(null, record());
      controller.rollback(null);
    }).not.toThrow();
    expect(log.read()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Fail closed
// ---------------------------------------------------------------------------

describe('DegradedAdmissionController — fail closed', () => {
  it('refuses the call while degraded', () => {
    const { controller, log, setAvailable } = makeHarness({
      policies: { prov_expensive: { failMode: 'fail_closed', exposureCeiling: 0 } },
    });
    setAvailable(false);

    const decision = controller.admit('prov_expensive', 500);

    expect(decision.admitted).toBe(false);
    expect(decision.degraded).toBe(true);
    expect(decision.reason).toBe('fail_closed');
    expect(decision.holdId).toBeNull();
    expect(log.read()).toHaveLength(0);
  });

  it('still admits while the store is healthy', () => {
    const { controller } = makeHarness({
      policies: { prov_expensive: { failMode: 'fail_closed' } },
    });
    expect(controller.admit('prov_expensive', 500).admitted).toBe(true);
  });

  it('counts rejections for the console', () => {
    const { controller, setAvailable } = makeHarness({
      policies: { prov_expensive: { failMode: 'fail_closed' } },
    });
    setAvailable(false);
    controller.admit('prov_expensive', 1);
    controller.admit('prov_expensive', 1);

    const status = controller.snapshot().providers.find((p) => p.providerId === 'prov_expensive');
    expect(status?.rejectedCalls).toBe(2);
    expect(controller.snapshot().totals.rejectedCalls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Bounded fail-open
// ---------------------------------------------------------------------------

describe('DegradedAdmissionController — bounded fail-open', () => {
  it('refuses once the ceiling is reached and emits one ceiling event', () => {
    const { controller, events, setAvailable } = makeHarness({
      defaultPolicy: { failMode: 'fail_open', exposureCeiling: 10 },
    });
    setAvailable(false);

    const first = controller.admit('prov_a', 6);
    controller.settle(first.holdId, record({ id: 'r1', amount: 6 }));

    const second = controller.admit('prov_a', 4);
    controller.settle(second.holdId, record({ id: 'r2', amount: 4 }));

    const third = controller.admit('prov_a', 1);
    expect(third.admitted).toBe(false);
    expect(third.reason).toBe('exposure_ceiling');
    expect(third.exposureRemaining).toBe(0);

    const ceilingEvents = events.filter((e) => e.type === 'ceiling_exhausted');
    expect(ceilingEvents).toHaveLength(1);
    expect(ceilingEvents[0].providerId).toBe('prov_a');

    // A second refused call does not re-alert.
    expect(controller.admit('prov_a', 1).admitted).toBe(false);
    expect(events.filter((e) => e.type === 'ceiling_exhausted')).toHaveLength(1);
  });

  it('counts in-flight holds against the ceiling so concurrent calls cannot overshoot', () => {
    const { controller, setAvailable } = makeHarness({
      defaultPolicy: { exposureCeiling: 10 },
    });
    setAvailable(false);

    const inFlight = controller.admit('prov_a', 7);
    expect(inFlight.admitted).toBe(true);

    const next = controller.admit('prov_a', 7);
    expect(next.admitted).toBe(false);
    expect(next.reason).toBe('exposure_ceiling');
  });

  it('uses the amount actually served, so a cheap call leaves room for more', () => {
    const { controller, setAvailable } = makeHarness({ defaultPolicy: { exposureCeiling: 10 } });
    setAvailable(false);

    const decision = controller.admit('prov_a', 10);
    controller.settle(decision.holdId, record({ amount: 3 }));

    expect(controller.admit('prov_a', 7).admitted).toBe(true);
    expect(controller.admit('prov_a', 1).admitted).toBe(false);
  });

  it('rejects when the ceiling is zero even under fail-open', () => {
    const { controller, setAvailable } = makeHarness({ defaultPolicy: { exposureCeiling: 0 } });
    setAvailable(false);
    expect(controller.admit('prov_a', 1).admitted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Per-provider policy
// ---------------------------------------------------------------------------

describe('DegradedAdmissionController — per-provider policy', () => {
  it('applies different policies to different providers in the same outage', () => {
    const { controller, setAvailable } = makeHarness({
      defaultPolicy: { failMode: 'fail_open', exposureCeiling: 1000 },
      policies: {
        prov_cheap: { failMode: 'fail_open', exposureCeiling: 500 },
        prov_expensive: { failMode: 'fail_closed', exposureCeiling: 0 },
      },
    });
    setAvailable(false);

    expect(controller.admit('prov_cheap', 10).admitted).toBe(true);
    expect(controller.admit('prov_expensive', 10).admitted).toBe(false);
    expect(controller.admit('prov_defaulted', 10).reason).toBe('fail_open');
  });

  it('keeps exposure budgets separate per provider', () => {
    const { controller, setAvailable } = makeHarness({
      policies: {
        prov_a: { failMode: 'fail_open', exposureCeiling: 5 },
        prov_b: { failMode: 'fail_open', exposureCeiling: 5 },
      },
    });
    setAvailable(false);

    const a = controller.admit('prov_a', 5);
    controller.settle(a.holdId, record({ providerId: 'prov_a', amount: 5 }));

    expect(controller.admit('prov_a', 1).admitted).toBe(false);
    expect(controller.admit('prov_b', 5).admitted).toBe(true);
  });

  it('setPolicy updates the policy used by the next admission', () => {
    const { controller, setAvailable } = makeHarness();
    setAvailable(false);

    expect(controller.admit('prov_a', 1).admitted).toBe(true);
    controller.setPolicy('prov_a', { failMode: 'fail_closed' });
    expect(controller.admit('prov_a', 1).admitted).toBe(false);
    expect(controller.policyFor('prov_a').failMode).toBe('fail_closed');
  });

  it('falls back to the platform default policy', () => {
    const { controller } = makeHarness();
    expect(controller.policyFor('unknown')).toEqual(DEFAULT_DEGRADED_POLICY);
  });
});

// ---------------------------------------------------------------------------
// 6. Entry / exit transitions
// ---------------------------------------------------------------------------

describe('DegradedAdmissionController — transitions', () => {
  it('fires exactly one entered event, then one exited event', () => {
    const { controller, events, setAvailable } = makeHarness();

    setAvailable(false);
    controller.admit('prov_a', 1);
    controller.admit('prov_a', 1);
    expect(events.map((e) => e.type)).toEqual(['entered']);

    setAvailable(true);
    controller.admit('prov_a', 1);
    expect(events.map((e) => e.type)).toEqual(['entered', 'exited']);
    expect(events[1].outageId).toBe(events[0].outageId);
  });

  it('resets the exposure budget when a new outage starts', () => {
    const { controller, events, setAvailable } = makeHarness({
      defaultPolicy: { exposureCeiling: 10 },
    });

    setAvailable(false);
    const first = controller.admit('prov_a', 10);
    controller.settle(first.holdId, record({ amount: 10 }));
    expect(controller.admit('prov_a', 1).admitted).toBe(false);

    setAvailable(true);
    controller.admit('prov_a', 1); // healthy call → observes the exit
    setAvailable(false);
    const revived = controller.admit('prov_a', 10); // observes the new entry

    expect(events.map((e) => e.type)).toEqual([
      'entered',
      'ceiling_exhausted',
      'exited',
      'entered',
    ]);
    expect(events[3].outageId).not.toBe(events[0].outageId);
    expect(revived.admitted).toBe(true);
    expect(controller.snapshot().outageId).toBe(events[3].outageId);
    expect(controller.snapshot().totals.exposureUsed).toBe(0);
  });

  it('does not let a throwing listener break admission', () => {
    const { clock } = makeClock();
    const controller = new DegradedAdmissionController({
      isCounterStoreAvailable: () => false,
      log: new InMemoryDegradedUsageLog(),
      clock,
      onEvent: () => {
        throw new Error('alert backend down');
      },
    });

    const decision = controller.admit('prov_a', 1);
    expect(decision.admitted).toBe(true);
  });

  it('observe() reports no transition while state is unchanged', () => {
    const { controller } = makeHarness();
    expect(controller.observe()).toBeNull();
    expect(controller.observe()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Console snapshot
// ---------------------------------------------------------------------------

describe('DegradedAdmissionController — console snapshot', () => {
  it('exposes degraded state, policy, exposure, and counters', () => {
    const { controller, setAvailable } = makeHarness({
      policies: { prov_a: { failMode: 'fail_open', exposureCeiling: 20 } },
    });

    const healthy = controller.snapshot();
    expect(healthy.degraded).toBe(false);
    expect(healthy.outageId).toBeNull();
    expect(healthy.enteredAt).toBeNull();

    setAvailable(false);
    const admitted = controller.admit('prov_a', 5);
    controller.settle(admitted.holdId, record({ amount: 5 }));
    controller.admit('prov_a', 100);

    const degraded = controller.snapshot();
    expect(degraded.degraded).toBe(true);
    expect(degraded.outageId).toBeTruthy();
    expect(degraded.enteredAt).toBeTruthy();
    expect(degraded.totals.exposureUsed).toBe(5);
    expect(degraded.totals.degradedCalls).toBe(1);
    expect(degraded.totals.rejectedCalls).toBe(1);

    const provider = degraded.providers.find((p) => p.providerId === 'prov_a');
    expect(provider).toMatchObject({
      failMode: 'fail_open',
      exposureCeiling: 20,
      exposureUsed: 5,
      exposureRemaining: 15,
      degradedCalls: 1,
      rejectedCalls: 1,
      ceilingExhausted: true,
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Durable log
// ---------------------------------------------------------------------------

describe('FileDegradedUsageLog', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'degraded-log-'));
    path = join(dir, 'nested', 'degraded-usage.jsonl');
  });

  it('creates the parent directory and round-trips records', () => {
    const log = new FileDegradedUsageLog(path);
    log.append(record({ id: 'a' }) as DegradedUsageRecord);
    log.append(record({ id: 'b', outageId: 'out_2' }) as DegradedUsageRecord);

    const read = log.read();
    expect(read).toHaveLength(2);
    expect(read[0].id).toBe('a');
    expect(read[1].outageId).toBe('out_2');
    expect(log.filePath).toBe(path);
  });

  it('returns an empty list when the file does not exist yet', () => {
    expect(new FileDegradedUsageLog(path).read()).toEqual([]);
  });

  it('stops at a torn tail instead of losing the whole file', () => {
    const log = new FileDegradedUsageLog(path);
    log.append(record({ id: 'ok' }) as DegradedUsageRecord);
    // Simulate a crash halfway through the next append.
    writeFileSync(path, '{"id":"torn","outageId":"out_1","prov', { flag: 'a' });

    const read = log.read();
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe('ok');
  });

  it('survives a controller restart: a new log instance reads what the old one wrote', () => {
    new FileDegradedUsageLog(path).append(record({ id: 'persisted' }) as DegradedUsageRecord);
    const reopened = new FileDegradedUsageLog(path).read();
    expect(reopened.map((r) => r.id)).toEqual(['persisted']);
  });
});

describe('dedupeDegradedUsage', () => {
  it('keeps one record per call id so replays cannot double-bill', () => {
    const records = [
      record({ id: 'r1', amount: 5 }) as DegradedUsageRecord,
      record({ id: 'r1', amount: 5 }) as DegradedUsageRecord,
      record({ id: 'r2', amount: 7 }) as DegradedUsageRecord,
    ];

    const deduped = dedupeDegradedUsage(records);
    expect(deduped).toHaveLength(2);
    expect(deduped.reduce((sum, r) => sum + r.amount, 0)).toBe(12);
  });
});
