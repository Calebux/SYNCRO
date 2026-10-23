/**
 * Chaos test: kill the gateway mid paid-call (#1685).
 *
 * Covers one kill point per case:
 *   1. between upstream response and commit,
 *   2. between commit and receipt,
 *   3. during settlement submission.
 *
 * Each case kills the gateway process (simulated SIGKILL: nothing after the
 * kill point runs and all volatile handles are dropped), restarts it against
 * the surviving durable state (meter ledger + journal, standing in for the
 * WAL/disk), runs recovery, and asserts:
 *   - no double charge,
 *   - no free call beyond policy (uncharged work is never served),
 *   - every reservation is resolved (committed, released, or expired),
 *   - every committed call has a receipt (and exactly one settlement).
 *
 * Runs nightly on the local stack via .github/workflows/chaos-nightly.yml.
 * On failure, see docs/runbooks/incident-runbooks.md (issue #1519).
 */
import { describe, it, expect } from 'vitest';
import { InMemoryAllowanceStore } from '../packages/metering/src/meter';
import { ReservationLedger } from '../packages/metering/src/reservation';
import { InMemoryProviderStore } from '../backend/src/v3/provider-store';
import { ReceiptService } from '../backend/src/v3/receipt-service';

type KillPoint = 'after-upstream' | 'after-commit' | 'during-settlement';

/** Stands in for SIGKILL: the process dies here; nothing below it runs. */
class SimulatedKill extends Error {
  constructor(public readonly killPoint: KillPoint) {
    super(`process killed at ${killPoint}`);
  }
}

const AGENT = 'agent-chaos';
const UPPER_BOUND = 10;
const ACTUAL = 4;

/** Durable state: survives the kill (disk / WAL in production). */
interface DurableWorld {
  nowMs: number;
  store: InMemoryAllowanceStore;
  ledger: ReservationLedger;
  journal: string[];
  calls: Map<string, { receiptId: string; amount: number }>;
}

/** Volatile gateway state: dropped when the process dies. */
interface Volatile {
  providers: InMemoryProviderStore;
  receipts: ReceiptService;
  providerId: string;
  routeId: string;
  scopeKey: string;
}

function newWorld(): DurableWorld {
  const world: DurableWorld = {
    nowMs: 1_000_000,
    store: new InMemoryAllowanceStore(),
    ledger: null as unknown as ReservationLedger,
    journal: [],
    calls: new Map(),
  };
  world.store.setLimit(AGENT, 1_000);
  world.ledger = new ReservationLedger(world.store, 1_000, () => world.nowMs);
  return world;
}

function setupVolatile(): Volatile {
  const providers = new InMemoryProviderStore();
  const receipts = new ReceiptService();
  const provider = providers.registerProvider({
    identity: 'chaos-provider',
    payoutAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    upstreamBaseUrl: 'https://upstream.example',
    agreementTerms: 'chaos',
    mode: 'staging',
  });
  provider.payoutVerified = true;
  const route = providers.registerRoute({
    providerId: provider.providerId,
    pathPattern: '/chaos/*',
    method: 'GET',
    unit: 'call',
    price: 2,
    quantityExtractor: 'one',
  });
  return { providers, receipts, providerId: provider.providerId, routeId: route.routeId, scopeKey: route.scopeKey };
}

function paidCall(world: DurableWorld, v: Volatile, killPoint: KillPoint | null): string {
  // 1. Reserve — hold upper-bound quota before touching the upstream.
  const reservation = world.ledger.reserve(AGENT, v.scopeKey, UPPER_BOUND);
  world.journal.push(`reserved:${reservation.id}`);

  // 2. Upstream call succeeds.
  const upstream = { status: 200, body: { ok: true } };
  if (upstream.status !== 200) {
    world.ledger.release(reservation.id);
    world.journal.push(`released:${reservation.id}`);
    throw new Error('upstream failed');
  }
  world.journal.push(`upstream-ok:${reservation.id}`);
  if (killPoint === 'after-upstream') throw new SimulatedKill(killPoint);

  // 3. Commit — settle against actual usage.
  const { charged } = world.ledger.commit(reservation.id, ACTUAL);
  world.journal.push(`committed:${reservation.id}:${charged}`);
  if (killPoint === 'after-commit') throw new SimulatedKill(killPoint);

  // 4. Receipt.
  const receiptId = `rcpt-${reservation.id}`;
  const receipt = v.receipts.issueReceipt({
    receiptId,
    route: v.scopeKey,
    unit: 'call',
    quantity: charged,
    amount: charged * 2,
    rateCardVersion: 'v1',
    exchangeRate: null,
    channelId: 'chan-chaos',
    stateNonce: 1,
    requestMethod: 'GET',
    requestPath: '/chaos/ping',
    requestQuery: {},
  });
  world.calls.set(reservation.id, { receiptId, amount: receipt.amount });
  world.journal.push(`receipt:${reservation.id}`);
  if (killPoint === 'during-settlement') throw new SimulatedKill(killPoint);

  // 5. Settlement submission.
  v.providers.recordSettlement({
    providerId: v.providerId,
    routeId: v.routeId,
    receiptId,
    method: 'GET',
    pathPattern: '/chaos/*',
    unit: 'call',
    quantity: charged,
    price: 2,
    amount: receipt.amount,
    rateCardVersion: 'v1',
    rateCardEffectiveFrom: new Date(world.nowMs).toISOString(),
    status: 'unsettled',
    meteredAt: new Date(world.nowMs).toISOString(),
    channelId: 'chan-chaos',
  });
  world.journal.push(`settled:${reservation.id}`);
  return reservation.id;
}

/**
 * Restart recovery: sweep orphaned holds past expiry, then replay the journal
 * idempotently — issue receipts for committed calls missing them, record
 * settlements for receipted calls missing them. Re-running recovery must
 * change nothing (no double charge, no duplicate receipt/settlement).
 */
function recover(world: DurableWorld, v: Volatile): void {
  world.nowMs += 60_000;
  world.ledger.sweep();
  // Fixpoint replay: one pass may derive entries (receipt → settlement) that a
  // later entry in the same pass depends on. Re-running must change nothing
  // (no double charge, no duplicate receipt/settlement).
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of [...world.journal]) {
      const [kind, reservationId] = entry.split(':');
      if (kind === 'committed' && !world.journal.some((e) => e === `receipt:${reservationId}`)) {
        ensureReceipt(world, v, reservationId);
        world.journal.push(`receipt:${reservationId}`);
        changed = true;
      }
      if (kind === 'receipt' && !world.journal.some((e) => e === `settled:${reservationId}`)) {
        // The receipt object died with the old process; re-materialize it in
        // the fresh store under the same id before completing settlement.
        ensureReceipt(world, v, reservationId);
        const ctx = world.calls.get(reservationId)!;
        const already = v.providers
          .listSettlements(v.providerId)
          .some((s) => s.receiptId === ctx.receiptId);
        if (!already) {
          v.providers.recordSettlement({
            providerId: v.providerId,
            routeId: v.routeId,
            receiptId: ctx.receiptId,
            method: 'GET',
            pathPattern: '/chaos/*',
            unit: 'call',
            quantity: ACTUAL,
            price: 2,
            amount: ctx.amount,
            rateCardVersion: 'v1',
            rateCardEffectiveFrom: new Date(world.nowMs).toISOString(),
            status: 'unsettled',
            meteredAt: new Date(world.nowMs).toISOString(),
            channelId: 'chan-chaos',
          });
        }
        world.journal.push(`settled:${reservationId}`);
        changed = true;
      }
    }
  }
}

/** Idempotent by receipt id: re-issues into a fresh store after a restart. */
function ensureReceipt(world: DurableWorld, v: Volatile, reservationId: string): void {
  const ctx = world.calls.get(reservationId);
  const receiptId = ctx?.receiptId ?? `rcpt-${reservationId}`;
  if (v.receipts.getReceipt(receiptId) !== null) return;
  v.receipts.issueReceipt({
    receiptId,
    route: v.scopeKey,
    unit: 'call',
    quantity: ACTUAL,
    amount: ctx?.amount ?? ACTUAL * 2,
    rateCardVersion: 'v1',
    exchangeRate: null,
    channelId: 'chan-chaos',
    stateNonce: 1,
    requestMethod: 'GET',
    requestPath: '/chaos/ping',
    requestQuery: {},
  });
  world.calls.set(reservationId, { receiptId, amount: ctx?.amount ?? ACTUAL * 2 });
}

function reservedIds(world: DurableWorld): string[] {
  return world.journal.filter((e) => e.startsWith('reserved:')).map((e) => e.split(':')[1]);
}

function expectAllReservationsResolved(world: DurableWorld): void {
  for (const id of reservedIds(world)) {
    const state = world.ledger.get(id)?.state;
    expect(['committed', 'released', 'expired']).toContain(state);
  }
}

describe('Issue #1685: chaos — kill the gateway mid paid-call', () => {
  it('kill point 1 (upstream response → commit): no charge, no free call, reservation resolved', () => {
    const world = newWorld();
    const v1 = setupVolatile();
    expect(() => paidCall(world, v1, 'after-upstream')).toThrow(SimulatedKill);

    // Restart with fresh volatile state; recover.
    const v2 = setupVolatile();
    recover(world, v2);

    // The killed call was never committed: uncharged and unserved (no receipt,
    // no settlement) — not a free call. Its hold expires via the sweeper.
    expect(world.store.usedBy(AGENT)).toBe(0);
    expect(v2.receipts.getReceipt(`rcpt-${reservedIds(world)[0]}`)).toBeNull();
    expect(v2.providers.listSettlements(v2.providerId)).toHaveLength(0);
    expectAllReservationsResolved(world);

    // Client retry after restart is charged exactly once.
    const retryId = paidCall(world, v2, null);
    expect(world.store.usedBy(AGENT)).toBe(ACTUAL);
    expect(world.journal.filter((e) => e.startsWith('committed:'))).toHaveLength(1);
    expect(v2.receipts.getReceipt(`rcpt-${retryId}`)).not.toBeNull();
    expectAllReservationsResolved(world);
  });

  it('kill point 2 (commit → receipt): charged once, receipt + settlement recovered, replay is idempotent', () => {
    const world = newWorld();
    const v1 = setupVolatile();
    expect(() => paidCall(world, v1, 'after-commit')).toThrow(SimulatedKill);

    const v2 = setupVolatile();
    recover(world, v2);

    // Committed exactly once — no double charge.
    expect(world.store.usedBy(AGENT)).toBe(ACTUAL);
    // Every committed call has a receipt, and recovery completed settlement.
    const committed = world.journal.filter((e) => e.startsWith('committed:'));
    expect(committed).toHaveLength(1);
    const id = committed[0].split(':')[1];
    expect(v2.receipts.getReceipt(`rcpt-${id}`)).not.toBeNull();
    expect(v2.providers.listSettlements(v2.providerId)).toHaveLength(1);
    expectAllReservationsResolved(world);

    // Recovery replay changes nothing.
    recover(world, v2);
    expect(world.store.usedBy(AGENT)).toBe(ACTUAL);
    expect(v2.providers.listSettlements(v2.providerId)).toHaveLength(1);
    expectAllReservationsResolved(world);
  });

  it('kill point 3 (during settlement): receipt kept, settlement recorded exactly once', () => {
    const world = newWorld();
    const v1 = setupVolatile();
    expect(() => paidCall(world, v1, 'during-settlement')).toThrow(SimulatedKill);

    const v2 = setupVolatile();
    recover(world, v2);

    // Charged once, receipt present, exactly one settlement after recovery.
    expect(world.store.usedBy(AGENT)).toBe(ACTUAL);
    const id = reservedIds(world)[0];
    expect(v2.receipts.getReceipt(`rcpt-${id}`)).not.toBeNull();
    expect(
      v2.providers.listSettlements(v2.providerId).filter((s) => s.receiptId === `rcpt-${id}`),
    ).toHaveLength(1);
    expectAllReservationsResolved(world);

    // Replay stays single.
    recover(world, v2);
    expect(world.store.usedBy(AGENT)).toBe(ACTUAL);
    expect(
      v2.providers.listSettlements(v2.providerId).filter((s) => s.receiptId === `rcpt-${id}`),
    ).toHaveLength(1);
  });
});
