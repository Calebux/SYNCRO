/**
 * Tests for usage reconciliation (issue #1445).
 *
 * The acceptance criteria for this issue are behavioural, so these tests are
 * written against observable behaviour rather than implementation detail:
 *
 *  1. A healthy window reports zero for all three deltas.
 *  2. An injected gap is detected, reported, and repaired — after repair the
 *     deltas are zero while the pre-repair view is retained for audit.
 *  3. Replay is at-most-once, enforced by the unique idempotency key.
 *  4. Each orphan class is detected and classified correctly.
 *  5. Committed-but-unsettled usage is handed to the settlement engine.
 *  6. A persisted report round-trips without losing repair detail.
 *
 * Supabase is replaced with an in-memory store that enforces the same unique
 * indexes as the migration, because those indexes *are* the idempotency
 * guarantee.
 */

// `config/env` validates on import and calls process.exit(1) when required
// variables are missing. These assignments must therefore run *before* the
// modules under test are loaded, which rules out top-level `import` statements
// (TypeScript hoists them above ordinary statements). Type-only imports are
// erased at runtime, so the real loads below use require().
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test-admin-key-for-jest';
process.env.CHANNEL_SIGNING_SECRET = process.env.CHANNEL_SIGNING_SECRET || 'test-channel-secret';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'smtp.example.com';
process.env.SMTP_PORT = process.env.SMTP_PORT || '587';
process.env.SMTP_USER = process.env.SMTP_USER || 'test-user';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'test-pass';

jest.mock('../src/config/database', () => {
  // The fake is created before the module registry is consulted so services can
  // hold a stable reference to it.
  const { createFakeStore } = require('./helpers/fake-usage-store');
  return { supabase: createFakeStore().client };
});

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

// The default health probe reaches into the Redis store; tests inject their own
// probe instead, but the import must not try to open a real connection.
jest.mock('../src/lib/redis-store', () => ({
  redisStoreInstance: { isDegraded: () => false },
}));

jest.mock('../src/middleware/requestContext', () => ({
  getRequestId: () => 'req-test',
}));

jest.mock('../src/services/settlement-batcher', () => {
  class SettlementBackpressureError extends Error {
    constructor() {
      super('Settlement queue at capacity');
      this.name = 'SettlementBackpressureError';
    }
  }
  return {
    SettlementBackpressureError,
    SettlementBatcher: class {},
    settlementBatcher: { enqueue: jest.fn() },
  };
});

import type { FakeStore } from './helpers/fake-usage-store';

// Loaded after the environment is primed. `require` keeps the ordering that
// top-level imports would otherwise break.
const { createFakeStore } =
  require('./helpers/fake-usage-store') as typeof import('./helpers/fake-usage-store');
const { supabase } = require('../src/config/database') as typeof import('../src/config/database');
const { MeterUsageLedgerService } =
  require('../src/services/usage/meter-usage-ledger') as typeof import('../src/services/usage/meter-usage-ledger');
const { DegradedUsageReplayService } =
  require('../src/services/usage/degraded-usage-replay') as typeof import('../src/services/usage/degraded-usage-replay');
const { OrphanDetectionService } =
  require('../src/services/usage/orphan-detection') as typeof import('../src/services/usage/orphan-detection');
const { SettlementHandoffService } =
  require('../src/services/usage/settlement-handoff') as typeof import('../src/services/usage/settlement-handoff');
const { UsageReconciliationService } =
  require('../src/services/usage/usage-reconciliation') as typeof import('../src/services/usage/usage-reconciliation');
const { toLedgerRow, toDegradedUsageRow } =
  require('../src/services/usage/row-mappers') as typeof import('../src/services/usage/row-mappers');
const { env } = require('../src/config/env') as typeof import('../src/config/env');

// ─── fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-05T04:10:00.000Z');
const HOUR = 3_600_000;

/** Ledger row for usage that was served and fully accounted for. */
function healthyRow(overrides: Record<string, any> = {}) {
  const at = new Date(NOW.getTime() - HOUR).toISOString();
  return {
    reservation_id: `res_${Math.random().toString(16).slice(2)}`,
    agent_id: 'agent_1',
    route: '/v3/proxy',
    unit_name: 'tokens',
    status: 'committed',
    reserved_units: 100,
    reserved_amount: 5,
    actual_units: 100,
    actual_amount: 5,
    fallback_used: false,
    metered_at: at,
    meter_idempotency_key: `meter:seed`,
    settled_at: at,
    reservation_expires_unused: null,
    reserved_at: at,
    expires_at: at,
    committed_at: at,
    released_at: null,
    ...overrides,
  };
}

let store: FakeStore;

beforeEach(() => {
  store = createFakeStore();
  // Re-point the mocked client at a fresh store per test.
  (supabase as any).from = (t: string) => store.from(t);
});

function buildLedger(degraded = false) {
  return new MeterUsageLedgerService(() => degraded);
}

/** Full stack over the fake store, with a fake settlement batcher. */
function buildStack(opts: { degraded?: boolean; batcher?: any } = {}) {
  const ledger = buildLedger(opts.degraded ?? false);
  const replay = new DegradedUsageReplayService(ledger);
  const orphans = new OrphanDetectionService();
  const handoff = new SettlementHandoffService(opts.batcher ?? { enqueue: jest.fn() });
  const service = new UsageReconciliationService(replay, orphans, handoff);
  return { ledger, replay, orphans, handoff, service };
}

/**
 * Anchor the window to the fixture clock.
 *
 * `run()` defaults `windowEnd` to real wall-clock time, so a test that left it
 * un-set would quietly re-slice a different 24h window on every run and start
 * passing or failing purely as the clock advanced. Every figure here is
 * relative to NOW, so the window must be too.
 */
function runOptions(overrides: Record<string, any> = {}) {
  return { windowEnd: NOW, windowHours: 24, ...overrides };
}

// ─── 1. healthy window ───────────────────────────────────────────────────────

describe('healthy window', () => {
  it('reports zero for all three deltas', async () => {
    for (let i = 0; i < 3; i++) {
      store.seed('meter_usage_ledger', healthyRow({ meter_idempotency_key: `meter:h${i}` }));
    }

    const { service } = buildStack();
    const report = await service.run(runOptions());

    expect(report.served).toEqual({ count: 3, amount: 15 });
    expect(report.metered).toEqual({ count: 3, amount: 15 });
    expect(report.settled).toEqual({ count: 3, amount: 15 });
    expect(report.deltas).toEqual({
      servedMinusMetered: 0,
      meteredMinusSettled: 0,
      servedMinusSettled: 0,
    });
    expect(report.healthy).toBe(true);
    expect(report.runError).toBeNull();
  });

  it('excludes usage outside the window', async () => {
    store.seed(
      'meter_usage_ledger',
      healthyRow({
        meter_idempotency_key: 'meter:old',
        committed_at: new Date(NOW.getTime() - 48 * HOUR).toISOString(),
        metered_at: new Date(NOW.getTime() - 48 * HOUR).toISOString(),
        settled_at: new Date(NOW.getTime() - 48 * HOUR).toISOString(),
      }),
    );

    const { service } = buildStack();
    const report = await service.run(runOptions());

    expect(report.served.count).toBe(0);
    expect(report.healthy).toBe(true);
  });

  it('does not count released reservations as served', async () => {
    const at = new Date(NOW.getTime() - HOUR).toISOString();
    store.seed('meter_usage_ledger', {
      ...healthyRow(),
      status: 'released',
      release_reason: 'Upstream call failed',
      actual_amount: null,
      actual_units: null,
      metered_at: null,
      meter_idempotency_key: null,
      settled_at: null,
      committed_at: null,
      released_at: at,
    });

    const { service } = buildStack();
    const report = await service.run(runOptions());

    expect(report.served.count).toBe(0);
    expect(report.healthy).toBe(true);
  });
});

// ─── 2. injected gap detected and repaired ───────────────────────────────────

describe('injected gap', () => {
  it('is detected, repaired by replay, and reported as zero post-repair', async () => {
    const servedAt = new Date(NOW.getTime() - 2 * HOUR).toISOString();

    // Usage that was served and committed, but never made it to the meter.
    store.seed('meter_usage_ledger', {
      ...healthyRow({
        actual_amount: 7.5,
        actual_units: 150,
        metered_at: null,
        meter_idempotency_key: null,
        settled_at: null,
      }),
    });

    // ...because it was queued for replay while the meter was degraded.
    store.seed('degraded_usage_log', {
      reservation_id: store.rows('meter_usage_ledger')[0].reservation_id,
      agent_id: 'agent_1',
      route: '/v3/proxy',
      unit_name: 'tokens',
      units: 150,
      amount: 7.5,
      reason: 'degraded_mode',
      served_at: servedAt,
      replay_state: 'pending',
      replay_attempts: 0,
      last_error: null,
    });

    const { service } = buildStack();
    const report = await service.run(runOptions());

    // Detected before repair: served > metered.
    expect(report.preRepairDeltas.servedMinusMetered).toBe(7.5);
    expect(report.preRepairDeltas.servedMinusMetered).toBeGreaterThan(0);

    // Repaired: usage reached the meter.
    expect(report.replay.replayed).toBe(1);
    expect(report.replay.replayedAmount).toBe(7.5);
    expect(report.deltas.servedMinusMetered).toBe(0);
    expect(report.metered).toEqual({ count: 1, amount: 7.5 });
    expect(report.healthy).toBe(true);

    // The finding is retained for audit even though it was auto-repaired.
    const classes = report.orphans.map((o) => o.orphanClass);
    expect(classes).toContain('awaiting_degraded_replay');
  });

  it('leaves the backlog queued for replay when replay is gated off', async () => {
    const at = new Date(NOW.getTime() - HOUR).toISOString();
    store.seed(
      'meter_usage_ledger',
      healthyRow({ metered_at: null, meter_idempotency_key: null, settled_at: null }),
    );
    store.seed('degraded_usage_log', {
      reservation_id: store.rows('meter_usage_ledger')[0].reservation_id,
      agent_id: 'agent_1',
      route: '/v3/proxy',
      unit_name: 'tokens',
      units: 100,
      amount: 5,
      reason: 'degraded_mode',
      served_at: at,
      replay_state: 'pending',
      replay_attempts: 0,
    });

    const { service } = buildStack();
    // The job gates replay on store health; this is that gate holding.
    const report = await service.run(runOptions({ skipReplay: true }));

    expect(report.replay.replayed).toBe(0);
    expect(report.deltas.servedMinusMetered).toBeGreaterThan(0);
    expect(report.healthy).toBe(false);
  });

  it('abandons an entry that exceeds the retry budget', async () => {
    const at = new Date(NOW.getTime() - HOUR).toISOString();
    // A released reservation can never be billed, so replay of this entry keeps
    // failing forever — exactly the case the retry cap exists to escalate.
    store.seed('meter_usage_ledger', {
      ...healthyRow({
        status: 'released',
        release_reason: 'Client disconnected prematurely',
        actual_amount: null,
        actual_units: null,
        committed_at: null,
        metered_at: null,
        meter_idempotency_key: null,
        settled_at: null,
        released_at: at,
      }),
    });
    store.seed('degraded_usage_log', {
      reservation_id: store.rows('meter_usage_ledger')[0].reservation_id,
      agent_id: 'agent_1',
      route: '/v3/proxy',
      unit_name: 'tokens',
      units: 100,
      amount: 5,
      reason: 'meter_write_failed',
      served_at: at,
      // Already exhausted the budget before this run.
      replay_state: 'failed',
      replay_attempts: Number(env.USAGE_REPLAY_MAX_ATTEMPTS),
      last_error: 'meter unreachable',
    });

    const { service } = buildStack();
    const report = await service.run(runOptions());

    expect(report.replay.abandoned).toBe(1);
    expect(store.rows('degraded_usage_log')[0].replay_state).toBe('abandoned');
  });
});

// ─── 3. replay is at-most-once ───────────────────────────────────────────────

describe('replay idempotency', () => {
  it('never applies the same usage to the meter twice', async () => {
    const at = new Date(NOW.getTime() - HOUR).toISOString();
    const reservationId = 'res_dup';
    store.seed('meter_usage_ledger', {
      ...healthyRow({
        reservation_id: reservationId,
        actual_amount: 4,
        metered_at: null,
        meter_idempotency_key: null,
        settled_at: null,
      }),
    });

    const ledger = buildLedger(false);

    // First application succeeds.
    expect(await ledger.applyToMeter(reservationId)).toEqual({
      applied: true,
      alreadyApplied: false,
    });
    // Second application is refused by the unique idempotency key.
    expect(await ledger.applyToMeter(reservationId)).toEqual({
      applied: false,
      alreadyApplied: true,
    });

    const row = store.rows('meter_usage_ledger')[0];
    expect(row.meter_idempotency_key).toBe(`meter:${reservationId}`);
    // Exactly one meter application is recorded.
    expect(store.rows('meter_usage_ledger').filter((r) => r.metered_at !== null)).toHaveLength(1);
    void at;
  });

  it('refuses to bill a reservation that was never committed', async () => {
    store.seed('meter_usage_ledger', {
      ...healthyRow({
        status: 'released',
        release_reason: 'Client disconnected prematurely',
        actual_amount: null,
        metered_at: null,
        meter_idempotency_key: null,
        committed_at: null,
      }),
    });

    const ledger = buildLedger(false);
    const replay = new DegradedUsageReplayService(ledger);

    store.seed('degraded_usage_log', {
      reservation_id: store.rows('meter_usage_ledger')[0].reservation_id,
      agent_id: 'agent_1',
      route: '/v3/proxy',
      unit_name: 'tokens',
      units: 100,
      amount: 5,
      reason: 'degraded_mode',
      served_at: new Date(NOW.getTime() - HOUR).toISOString(),
      replay_state: 'pending',
      replay_attempts: 0,
    });

    const outcome = await replay.replay({ servedBefore: NOW, maxAttempts: 5 });

    expect(outcome.replayed).toBe(0);
    expect(store.rows('meter_usage_ledger')[0].metered_at ?? null).toBeNull();
  });

  it('deduplicates the degraded log by reservation id', async () => {
    const reservationId = 'res_unique';
    const row = {
      reservation_id: reservationId,
      agent_id: 'agent_1',
      route: '/v3/proxy',
      unit_name: 'tokens',
      units: 10,
      amount: 1,
      reason: 'degraded_mode',
      served_at: new Date().toISOString(),
    };

    const first = await supabase.from('degraded_usage_log').insert(row);
    const second = await supabase.from('degraded_usage_log').insert(row);

    expect(first.error).toBeNull();
    expect(second.error?.code).toBe('23505');
    expect(store.rows('degraded_usage_log')).toHaveLength(1);
  });
});

// ─── 4. orphan classification ────────────────────────────────────────────────

describe('orphan detection', () => {
  const orphans = () => new OrphanDetectionService();

  it('classifies a reservation stuck between reserve and commit', async () => {
    store.seed('meter_usage_ledger', {
      ...healthyRow({
        status: 'reserved',
        actual_amount: null,
        actual_units: null,
        committed_at: null,
        metered_at: null,
        meter_idempotency_key: null,
        settled_at: null,
        reserved_at: new Date(NOW.getTime() - 5 * HOUR).toISOString(),
        expires_at: new Date(NOW.getTime() - 4 * HOUR).toISOString(),
      }),
    });

    const findings = await orphans().scan({ now: NOW });
    const stuck = findings.find((f) => f.reservationId === store.rows('meter_usage_ledger')[0].reservation_id);

    expect(stuck?.orphanClass).toBe('crash_between_reserve_and_commit');
    // Never auto-billed: whether the upstream ran is unknowable.
    expect(stuck?.autoRepairable).toBe(false);
  });

  it('classifies a release that landed after the TTL', async () => {
    store.seed('meter_usage_ledger', {
      ...healthyRow({
        status: 'released',
        release_reason: 'Upstream call failed',
        actual_amount: null,
        actual_units: null,
        committed_at: null,
        metered_at: null,
        meter_idempotency_key: null,
        settled_at: null,
        expires_at: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
        released_at: new Date(NOW.getTime() - HOUR).toISOString(),
      }),
    });

    const findings = await orphans().scan({ now: NOW });
    expect(findings.map((f) => f.orphanClass)).toContain('late_release');
  });

  it('does not classify a promptly released reservation', async () => {
    store.seed('meter_usage_ledger', {
      ...healthyRow({
        status: 'released',
        release_reason: 'Client disconnected prematurely',
        actual_amount: null,
        actual_units: null,
        committed_at: null,
        metered_at: null,
        meter_idempotency_key: null,
        settled_at: null,
        // Released well inside the reservation window.
        expires_at: new Date(NOW.getTime() + HOUR).toISOString(),
        released_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      }),
    });

    const findings = await orphans().scan({ now: NOW });
    expect(findings.map((f) => f.orphanClass)).not.toContain('late_release');
  });

  it('classifies usage awaiting degraded replay', async () => {
    store.seed(
      'meter_usage_ledger',
      healthyRow({ metered_at: null, meter_idempotency_key: null, settled_at: null }),
    );
    store.seed('degraded_usage_log', {
      reservation_id: store.rows('meter_usage_ledger')[0].reservation_id,
      agent_id: 'agent_1',
      route: '/v3/proxy',
      unit_name: 'tokens',
      units: 100,
      amount: 5,
      reason: 'degraded_mode',
      served_at: new Date(NOW.getTime() - HOUR).toISOString(),
      replay_state: 'pending',
      replay_attempts: 0,
    });

    const findings = await orphans().scan({ now: NOW });
    expect(findings.map((f) => f.orphanClass)).toEqual(['awaiting_degraded_replay']);
  });

  it('gives one row exactly one class even when several detectors match', async () => {
    // Committed, unmetered, and queued for replay: all three detectors fire.
    store.seed(
      'meter_usage_ledger',
      healthyRow({ metered_at: null, meter_idempotency_key: null, settled_at: null }),
    );
    store.seed('degraded_usage_log', {
      reservation_id: store.rows('meter_usage_ledger')[0].reservation_id,
      agent_id: 'agent_1',
      route: '/v3/proxy',
      unit_name: 'tokens',
      units: 100,
      amount: 5,
      reason: 'degraded_mode',
      served_at: new Date(NOW.getTime() - HOUR).toISOString(),
      replay_state: 'pending',
      replay_attempts: 0,
    });

    const findings = await orphans().scan({ now: NOW });
    const reservationId = store.rows('meter_usage_ledger')[0].reservation_id;

    // One finding for one row, so the total cannot exceed the row count and the
    // single orphan_class column cannot disagree with the report.
    expect(findings.filter((f) => f.reservationId === reservationId)).toHaveLength(1);
    // The most specific class wins.
    expect(findings[0].orphanClass).toBe('awaiting_degraded_replay');
    expect(store.rows('meter_usage_ledger')[0].orphan_class).toBe('awaiting_degraded_replay');
  });
});

// ─── 5. settlement hand-off ──────────────────────────────────────────────────

describe('settlement handoff', () => {
  function unsettledRow() {
    const at = new Date(NOW.getTime() - 2 * HOUR).toISOString();
    return healthyRow({
      actual_amount: 9,
      metered_at: at,
      meter_idempotency_key: 'meter:unsettled',
      settled_at: null,
      committed_at: at,
    });
  }

  it('queues committed-but-unsettled usage with the settlement engine', async () => {
    store.seed('meter_usage_ledger', unsettledRow());
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const { handoff } = buildStack({ batcher: { enqueue } });

    const outcome = await handoff.handoffUnsettledUsage({ now: NOW, graceMs: HOUR });

    expect(outcome.handedOff).toBe(1);
    expect(outcome.handedOffAmount).toBe(9);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      userId: 'agent_1',
      amount: 9,
      settlementType: 'renewal',
    });
    expect(store.rows('meter_usage_ledger')[0].settled_at).not.toBeNull();
  });

  it('leaves usage unsettled when the settlement queue is full', async () => {
    store.seed('meter_usage_ledger', unsettledRow());
    const { SettlementBackpressureError } = require('../src/services/settlement-batcher');
    const enqueue = jest.fn().mockRejectedValue(new SettlementBackpressureError());
    const { handoff } = buildStack({ batcher: { enqueue } });

    const outcome = await handoff.handoffUnsettledUsage({ now: NOW, graceMs: HOUR });

    expect(outcome.backpressured).toBe(1);
    expect(outcome.handedOff).toBe(0);
    // Left for a later run rather than dropped.
    expect(store.rows('meter_usage_ledger')[0].settled_at).toBeNull();
  });

  it('does not re-queue usage already present in the settlement queue', async () => {
    store.seed('meter_usage_ledger', unsettledRow());
    const reservationId = store.rows('meter_usage_ledger')[0].reservation_id;
    store.seed('pending_settlements', {
      subscription_id: `usage:${reservationId}`,
      user_id: 'agent_1',
      amount: 9,
      status: 'pending',
    });

    const enqueue = jest.fn();
    const { handoff } = buildStack({ batcher: { enqueue } });

    const outcome = await handoff.handoffUnsettledUsage({ now: NOW, graceMs: HOUR });

    expect(enqueue).not.toHaveBeenCalled();
    expect(outcome.handedOff).toBe(1);
    expect(store.rows('meter_usage_ledger')[0].settled_at).not.toBeNull();
  });

  it('leaves usage inside the grace period alone', async () => {
    const at = new Date(NOW.getTime() - 60_000).toISOString();
    store.seed(
      'meter_usage_ledger',
      healthyRow({ metered_at: at, meter_idempotency_key: 'meter:fresh', settled_at: null, committed_at: at }),
    );

    const enqueue = jest.fn();
    const { handoff } = buildStack({ batcher: { enqueue } });
    const outcome = await handoff.handoffUnsettledUsage({ now: NOW, graceMs: HOUR });

    expect(outcome.handedOff).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

// ─── 6. report round trip ────────────────────────────────────────────────────

describe('report persistence', () => {
  it('persists and reads back every repair field without inventing values', async () => {
    store.seed('meter_usage_ledger', healthyRow());
    const { service } = buildStack();
    const written = await service.run(runOptions());

    const readBack = await service.getLatestReport();

    expect(readBack).not.toBeNull();
    expect(readBack!.runId).toBe(written.runId);
    expect(readBack!.deltas).toEqual(written.deltas);
    expect(readBack!.preRepairDeltas).toEqual(written.preRepairDeltas);
    // These four have no scalar column; they must come from repair_outcomes
    // rather than silently defaulting to zero.
    expect(readBack!.replay).toEqual(written.replay);
    expect(readBack!.settlementHandoff).toEqual(written.settlementHandoff);
  });

  it('records the failure when the store is unreachable instead of reporting zero', async () => {
    store.seed('meter_usage_ledger', healthyRow());
    store.failNext('meter_usage_ledger');
    const { service } = buildStack();

    const report = await service.run(runOptions());

    // A measurement that could not be taken must not be mistaken for a healthy
    // window of zero usage — that is how a real outage hides inside a green report.
    expect(report.runError).toBeTruthy();
    expect(report.healthy).toBe(false);
  });

  it('preserves repair details that have no scalar column', async () => {
    // A released reservation can never be billed, so its replay entry is
    // abandoned; a full settlement queue leaves usage backpressured. Both
    // counters exist only in repair_outcomes.
    store.seed('meter_usage_ledger', {
      ...healthyRow({
        status: 'released',
        release_reason: 'Client disconnected prematurely',
        actual_amount: null,
        actual_units: null,
        committed_at: null,
        metered_at: null,
        meter_idempotency_key: null,
        settled_at: null,
      }),
    });
    store.seed('degraded_usage_log', {
      reservation_id: store.rows('meter_usage_ledger')[0].reservation_id,
      agent_id: 'agent_1',
      route: '/v3/proxy',
      unit_name: 'tokens',
      units: 100,
      amount: 5,
      reason: 'meter_write_failed',
      served_at: new Date(NOW.getTime() - HOUR).toISOString(),
      replay_state: 'failed',
      replay_attempts: Number(env.USAGE_REPLAY_MAX_ATTEMPTS),
      last_error: 'meter unreachable',
    });

    // A second, fully metered row that is settled but stuck in a full queue.
    const at = new Date(NOW.getTime() - 2 * HOUR).toISOString();
    store.seed(
      'meter_usage_ledger',
      healthyRow({
        actual_amount: 3,
        metered_at: at,
        meter_idempotency_key: 'meter:stuck',
        settled_at: null,
        committed_at: at,
      }),
    );

    const { SettlementBackpressureError } = require('../src/services/settlement-batcher');
    const { service } = buildStack({
      batcher: { enqueue: jest.fn().mockRejectedValue(new SettlementBackpressureError()) },
    });

    const written = await service.run(runOptions());
    expect(written.replay.abandoned).toBe(1);
    expect(written.settlementHandoff.backpressured).toBe(1);

    const readBack = await service.getLatestReport();
    // Without repair_outcomes these would silently read back as 0 and a real
    // abandoned or backpressured entry would disappear from the audit trail.
    expect(readBack!.replay.abandoned).toBe(1);
    expect(readBack!.settlementHandoff.backpressured).toBe(1);
  });

  it('returns null when no report has been written', async () => {
    const { service } = buildStack();
    expect(await service.getLatestReport()).toBeNull();
  });
});

// ─── row mapping ─────────────────────────────────────────────────────────────

describe('row mappers', () => {
  it('maps snake_case ledger columns and coerces numeric strings', () => {
    const mapped = toLedgerRow({
      id: 'abc',
      reservation_id: 'res_1',
      agent_id: 'agent_9',
      route: '/v3/proxy',
      unit_name: 'tokens',
      status: 'committed',
      reserved_units: '100',
      reserved_amount: '5.50',
      actual_units: '100',
      actual_amount: '5.25',
      fallback_used: true,
      metered_at: '2026-10-05T03:00:00.000Z',
      meter_idempotency_key: 'meter:res_1',
      settled_at: null,
      settlement_ref: null,
      orphan_class: null,
      correlation_id: 'req-1',
      reserved_at: '2026-10-05T02:00:00.000Z',
      expires_at: '2026-10-05T02:01:00.000Z',
      committed_at: '2026-10-05T02:00:30.000Z',
      released_at: null,
    });

    expect(mapped.reservationId).toBe('res_1');
    expect(mapped.agentId).toBe('agent_9');
    expect(mapped.actualAmount).toBe(5.25);
    expect(mapped.reservedAmount).toBe(5.5);
    expect(mapped.fallbackUsed).toBe(true);
    expect(mapped.meteredAt).toBe('2026-10-05T03:00:00.000Z');
    expect(mapped.settledAt).toBeNull();
  });

  it('preserves the null/non-null distinction of nullable amounts', () => {
    const mapped = toLedgerRow({ status: 'reserved', actual_amount: null, actual_units: null });

    // null means "not yet known"; 0 would mean "known to be zero" and would
    // understate a served total.
    expect(mapped.actualAmount).toBeNull();
    expect(mapped.actualUnits).toBeNull();
  });

  it('collapses unparseable numerics to zero instead of NaN', () => {
    const mapped = toLedgerRow({ actual_amount: 'not-a-number', reserved_units: undefined });
    expect(mapped.actualAmount).toBe(0);
    expect(mapped.reservedUnits).toBe(0);
  });

  it('maps degraded log rows', () => {
    const mapped = toDegradedUsageRow({
      reservation_id: 'res_2',
      replay_state: 'failed',
      replay_attempts: '3',
      amount: '2.5',
      units: 10,
      reason: 'meter_write_failed',
      last_error: 'timeout',
    });

    expect(mapped.reservationId).toBe('res_2');
    expect(mapped.replayState).toBe('failed');
    expect(mapped.replayAttempts).toBe(3);
    expect(mapped.amount).toBe(2.5);
    expect(mapped.lastError).toBe('timeout');
  });
});

// ─── commit path ─────────────────────────────────────────────────────────────

describe('commit', () => {
  it('meters usage in one write when the meter is healthy', async () => {
    const ledger = buildLedger(false);
    await ledger.reserve({
      agentId: 'agent_1',
      route: '/v3/proxy',
      unitName: 'tokens',
      reservedUnits: 100,
      reservedAmount: 5,
    });

    const reservationId = store.rows('meter_usage_ledger')[0].reservation_id;
    const outcome = await ledger.commit({
      reservationId,
      actualUnits: 100,
      actualAmount: 5,
      fallbackUsed: false,
    });

    expect(outcome.metered).toBe(true);
    expect(outcome.queuedForReplay).toBe(false);

    const row = store.rows('meter_usage_ledger')[0];
    expect(row.status).toBe('committed');
    expect(row.metered_at).not.toBeNull();
    expect(row.meter_idempotency_key).toBe(`meter:${reservationId}`);
    // Healthy path must not create replay work.
    expect(store.rows('degraded_usage_log')).toHaveLength(0);
  });

  it('queues for replay instead of metering when the meter is degraded', async () => {
    const ledger = buildLedger(true);
    const reserved = await ledger.reserve({
      agentId: 'agent_1',
      route: '/v3/proxy',
      unitName: 'tokens',
      reservedUnits: 100,
      reservedAmount: 5,
    });

    const outcome = await ledger.commit({
      reservationId: reserved.reservationId,
      actualUnits: 100,
      actualAmount: 5,
      fallbackUsed: true,
    });

    expect(outcome.metered).toBe(false);
    expect(outcome.queuedForReplay).toBe(true);
    expect(outcome.reason).toBe('degraded_mode');

    expect(store.rows('meter_usage_ledger')[0].metered_at ?? null).toBeNull();
    expect(store.rows('degraded_usage_log')).toHaveLength(1);
  });

  it('refuses a reservation whose durable write failed', async () => {
    store.failNext('meter_usage_ledger');
    const ledger = buildLedger(false);

    const outcome = await ledger.reserve({
      agentId: 'agent_1',
      route: '/v3/proxy',
      unitName: 'tokens',
      reservedUnits: 100,
      reservedAmount: 5,
    });

    expect(outcome.persisted).toBe(false);
  });

  it('never commits a released reservation', async () => {
    const ledger = buildLedger(false);
    const reserved = await ledger.reserve({
      agentId: 'agent_1',
      route: '/v3/proxy',
      unitName: 'tokens',
      reservedUnits: 100,
      reservedAmount: 5,
    });
    await ledger.release(reserved.reservationId, 'Client disconnected prematurely');

    const outcome = await ledger.commit({
      reservationId: reserved.reservationId,
      actualUnits: 100,
      actualAmount: 5,
      fallbackUsed: false,
    });

    // The released row is untouched.
    expect(store.rows('meter_usage_ledger')[0].status).toBe('released');
    expect(store.rows('meter_usage_ledger')[0].metered_at ?? null).toBeNull();
    expect(outcome.metered).toBe(false);
  });
});
