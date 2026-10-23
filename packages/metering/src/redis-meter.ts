/**
 * Meter backed by a shared CounterStore (typically Redis).
 *
 * Presents the same reserve / commit / release / read lifecycle as
 * `InMemoryMeter`, but every balance mutation goes through the counter store
 * so multiple gateway instances enforce one balance. Window aggregation and
 * overage warnings stay in-process; the shared store is the source of truth
 * for caps.
 *
 * Methods are async because the counter store is. When the store is down the
 * calls reject with `CounterStoreUnavailableError` — degraded-mode handling
 * is Issue #1444, not this adapter.
 */

import type { MeterClock } from './clock';
import type { DegradedModeEvaluator, DegradedModeResult } from './degraded';
import {
  evaluateOverage,
  recordUsage,
  createOverageState,
  type OverageState,
} from './overage';
import { readCurrentWindow } from './usage-read';
import { WindowStore, type WindowStoreOptions } from './window';
import type { CounterStore } from './counter-store';
import type {
  MeterCommitResult,
  MeterReading,
  MeterReservation,
} from './meter';

export interface RedisMeterOptions {
  store: CounterStore;
  windowDurationMs?: number;
  limits?: Record<string, number>;
  clock?: (() => number) | MeterClock;
  degradedEvaluator?: DegradedModeEvaluator;
}

/**
 * Async meter whose allowance lives in a CounterStore.
 *
 * Does not implement the synchronous `Meter` interface — Redis I/O cannot be
 * sync. Gateways that need the shared store await these methods; the in-memory
 * meter remains the sync hot path for single-process tests.
 */
export class RedisMeter {
  private readonly store: CounterStore;
  private readonly windowStore: WindowStore;
  private readonly overageStates = new Map<string, OverageState>();
  private readonly principals = new Map<string, string>();
  private readonly degradedEvaluator?: DegradedModeEvaluator;
  private readonly clock: () => number;
  private readonly limitsReady: Promise<void>;

  constructor(options: RedisMeterOptions) {
    this.store = options.store;
    this.degradedEvaluator = options.degradedEvaluator;

    const clockInput = options.clock;
    let clockFn: () => number;
    let clockSourceLabel: import('./clock').ClockSource = 'system';
    if (!clockInput) {
      clockFn = () => Date.now();
    } else if (typeof clockInput === 'function') {
      clockFn = clockInput;
      clockSourceLabel = 'test';
    } else {
      clockFn = () => clockInput.now();
      clockSourceLabel = clockInput.source;
    }
    this.clock = clockFn;

    const windowOpts: WindowStoreOptions = {
      durationMs: options.windowDurationMs ?? 60_000,
      clock: this.clock,
      lateArrivalPolicy: 'redirect',
      clockSource: clockSourceLabel,
    };
    this.windowStore = new WindowStore(windowOpts);

    const store = this.store;
    this.limitsReady = (async () => {
      if (!options.limits) return;
      for (const [principal, limit] of Object.entries(options.limits)) {
        await store.setLimit(principal, limit);
        this.syncOverageLimit(principal, limit);
      }
    })();
  }

  async ready(): Promise<void> {
    await this.limitsReady;
  }

  async setLimit(principal: string, limit: number): Promise<void> {
    await this.limitsReady;
    await this.store.setLimit(principal, limit);
    this.syncOverageLimit(principal, limit);
  }

  async reserve(
    principal: string,
    route: string,
    upperBound: number,
  ): Promise<MeterReservation> {
    await this.limitsReady;
    const degradedResult = this.checkDegraded();

    try {
      const r = await this.store.reserve(principal, route, upperBound);
      this.principals.set(r.id, principal);
      return {
        id: r.id,
        principal,
        route,
        upperBound,
        expiresAt: r.expiresAt,
        degraded: degradedResult.degraded,
      };
    } catch (err) {
      if (degradedResult.degraded) {
        const expiresAt = this.clock() + 60_000;
        const id = `rsv_deg_${principal}_${this.clock().toString(36)}`;
        this.principals.set(id, principal);
        return {
          id,
          principal,
          route,
          upperBound,
          expiresAt,
          degraded: true,
        };
      }
      throw err;
    }
  }

  async commit(
    reservationId: string,
    actual: number,
    idempotencyKey?: string,
  ): Promise<MeterCommitResult> {
    await this.limitsReady;

    if (reservationId.startsWith('rsv_deg_')) {
      const principal =
        this.principals.get(reservationId) ??
        reservationId.split('_')[2] ??
        'unknown';
      this.windowStore.recordUsage(principal, this.clock(), actual);
      return { charged: actual, released: 0, warnings: [] };
    }

    const { charged, released, replayed } = await this.store.commit(
      reservationId,
      actual,
      idempotencyKey,
    );

    if (replayed) {
      return { charged, released, warnings: [] };
    }

    const principal = this.principals.get(reservationId);
    if (principal) {
      this.windowStore.recordUsage(principal, this.clock(), actual);
      const snap = await this.store.read(principal);
      const state = this.getOrCreateOverageState(principal, snap.limit);
      recordUsage(state, actual);
      const decision = evaluateOverage(state, 0);
      return {
        charged,
        released,
        warnings: decision.warnings.map((w) => w.message),
      };
    }

    return { charged, released, warnings: [] };
  }

  async release(reservationId: string): Promise<void> {
    await this.limitsReady;
    if (reservationId.startsWith('rsv_deg_')) return;
    await this.store.release(reservationId);
  }

  async read(principal: string): Promise<MeterReading> {
    await this.limitsReady;
    const snap = await this.store.read(principal);
    const { windowStart } = readCurrentWindow(this.windowStore, principal);
    const remaining =
      snap.limit === Infinity
        ? Infinity
        : Math.max(0, snap.limit - snap.used);
    return {
      principal,
      used: snap.used,
      limit: snap.limit,
      remaining,
      windowStart,
      degraded: this.checkDegraded().degraded,
    };
  }

  private checkDegraded(): DegradedModeResult {
    if (!this.degradedEvaluator) return { degraded: false, servicesToLimit: [] };
    return this.degradedEvaluator.evaluate();
  }

  private syncOverageLimit(principal: string, limit: number): void {
    const existing = this.overageStates.get(principal);
    if (existing) {
      existing.policy = { ...existing.policy, limit };
    }
  }

  private getOrCreateOverageState(
    principal: string,
    limit: number,
  ): OverageState {
    let state = this.overageStates.get(principal);
    if (!state) {
      state = createOverageState({
        limit: limit === Infinity ? 0 : limit,
      });
      this.overageStates.set(principal, state);
    }
    return state;
  }
}
