/**
 * Public Meter interface for the metering core (Issue #1440).
 *
 * This is the single boundary the gateway calls. Internals — windows, ledgers,
 * WAL, overage policy — are behind this interface so they can be swapped without
 * touching callers.
 *
 * The four operations map directly to the lifecycle of a paid call:
 *
 *   1. reserve  — before the upstream call: hold an upper-bound quota.
 *   2. commit   — after success: settle against actual usage; excess is released.
 *   3. release  — after failure: return the full hold; a failed call is never free.
 *   4. read     — anywhere: return the current usage for a principal.
 *
 * Degraded mode is a first-class property of the meter, not a special case.
 * When the counter store is unavailable, or when a DegradedModeEvaluator flags
 * the system, the meter activates its degraded policy:
 *
 *   - reserve still succeeds, returning a reservation tagged `degraded: true`.
 *   - Usage is counted optimistically (allow, but flag) so the gateway stays alive.
 *   - Callers surface the `degraded` flag to agents via a response header.
 *
 * This mirrors the Python quota_guard DegradedMode.evaluate() semantics from
 * quota_guard/degraded_mode.py, ported into a first-class TypeScript policy.
 */

import { ReservationLedger, type Reservation, type AllowanceStore } from './reservation';
import { WindowStore, type WindowStoreOptions } from './window';
import { readCurrentWindow } from './usage-read';
import { evaluateOverage, type OverageState, createOverageState, recordUsage } from './overage';
import type { DegradedModeEvaluator, DegradedModeResult } from './degraded';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A held reservation returned by `meter.reserve()`.
 *
 * `degraded: true` means the meter is operating in degraded mode — the
 * reservation was made optimistically and the caller should surface this to the
 * agent via an appropriate response header (e.g. `X-Meter-Degraded: 1`).
 */
export interface MeterReservation {
  /** Stable id for commit/release. */
  id: string;
  /** Principal the reservation is held for. */
  principal: string;
  /** Route the reservation is tied to. */
  route: string;
  /** Upper-bound units held. */
  upperBound: number;
  /** Unix ms when the hold expires. */
  expiresAt: number;
  /** True when the meter is operating in degraded mode. */
  degraded: boolean;
}

/**
 * Result of a successful `meter.commit()`.
 */
export interface MeterCommitResult {
  /** Units actually charged. */
  charged: number;
  /** Units returned from the upper-bound hold. */
  released: number;
  /** True if the commit triggered a warning threshold. */
  warnings: string[];
}

/**
 * Snapshot of the current usage for a principal (fast path, no I/O).
 */
export interface MeterReading {
  principal: string;
  /** Units consumed in the current window. */
  used: number;
  /** Configured limit for the principal. */
  limit: number;
  /** Units remaining before the cap binds (never negative). */
  remaining: number;
  /** Epoch ms of the window boundary. */
  windowStart: number;
  /** True when the meter is operating in degraded mode. */
  degraded: boolean;
}

// ---------------------------------------------------------------------------
// Meter interface
// ---------------------------------------------------------------------------

/**
 * The public surface of the metering core.
 *
 * Every implementation must satisfy this interface so the gateway can be
 * tested against an in-memory implementation and deployed against a durable one.
 */
export interface Meter {
  reserve(principal: string, route: string, upperBound: number): MeterReservation;
  commit(reservationId: string, actual: number): MeterCommitResult;
  release(reservationId: string): void;
  read(principal: string): MeterReading;
}

// ---------------------------------------------------------------------------
// InMemoryAllowanceStore — satisfies AllowanceStore for the ReservationLedger
// ---------------------------------------------------------------------------

/**
 * Simple in-memory allowance store.  Limits are set per-principal; usage is
 * accumulated and checked on every reserve/commit.
 */
export class InMemoryAllowanceStore implements AllowanceStore {
  private readonly limits = new Map<string, number>();
  private readonly usage = new Map<string, number>();
  private readonly applied = new Set<string>();

  setLimit(principal: string, limit: number): void {
    this.limits.set(principal, limit);
  }

  limitFor(principal: string): number {
    return this.limits.get(principal) ?? Infinity;
  }

  usedBy(principal: string): number {
    return this.usage.get(principal) ?? 0;
  }

  /** Idempotent per reservationId. */
  recordUsage(principal: string, amount: number, reservationId: string): void {
    if (this.applied.has(reservationId)) return;
    this.applied.add(reservationId);
    this.usage.set(principal, (this.usage.get(principal) ?? 0) + amount);
  }

  resetUsage(principal: string): void {
    this.usage.delete(principal);
    // applied set is intentionally not cleared: idempotency must survive resets.
  }
}

// ---------------------------------------------------------------------------
// InMemoryMeter — the default implementation
// ---------------------------------------------------------------------------

export interface InMemoryMeterOptions {
  /** Width of each aggregation window in milliseconds. Default: 60_000 (1 min). */
  windowDurationMs?: number;
  /** Per-principal limits. Entries can also be set later via `setLimit`. */
  limits?: Record<string, number>;
  /** Injectable clock for deterministic tests. */
  clock?: () => number;
  /** Degraded-mode evaluator. If omitted, degraded mode is never activated. */
  degradedEvaluator?: DegradedModeEvaluator;
  /** Reservation timeout in ms. Default: 60_000. */
  reservationTimeoutMs?: number;
}

/**
 * Default, fully in-memory `Meter` implementation.
 *
 * All operations are synchronous and sub-millisecond. Suitable for production
 * admission paths and for tests. Durability (WAL, persistent store) is layered
 * on top via the `DurableMeter` in `write-ahead-log.ts` and `recovery.ts`.
 */
export class InMemoryMeter implements Meter {
  private readonly store: InMemoryAllowanceStore;
  private readonly ledger: ReservationLedger;
  private readonly windowStore: WindowStore;
  private readonly overageStates = new Map<string, OverageState>();
  private readonly degradedEvaluator?: DegradedModeEvaluator;
  private readonly clock: () => number;

  constructor(options: InMemoryMeterOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.store = new InMemoryAllowanceStore();
    if (options.limits) {
      for (const [principal, limit] of Object.entries(options.limits)) {
        this.store.setLimit(principal, limit);
      }
    }
    this.ledger = new ReservationLedger(
      this.store,
      options.reservationTimeoutMs ?? 60_000,
      this.clock,
    );
    const windowOpts: WindowStoreOptions = {
      durationMs: options.windowDurationMs ?? 60_000,
      clock: this.clock,
      lateArrivalPolicy: 'redirect',
    };
    this.windowStore = new WindowStore(windowOpts);
    this.degradedEvaluator = options.degradedEvaluator;
  }

  /**
   * Set or update the quota limit for a principal.
   * Must be called before the first `reserve` for that principal if a finite
   * limit is desired.
   */
  setLimit(principal: string, limit: number): void {
    this.store.setLimit(principal, limit);
    // Keep the overage state in sync so warning thresholds use the new limit.
    const existing = this.overageStates.get(principal);
    if (existing) {
      existing.policy = { ...existing.policy, limit };
    }
  }

  // -------------------------------------------------------------------------
  // Meter interface
  // -------------------------------------------------------------------------

  /**
   * Hold an upper-bound quota before the upstream call.
   *
   * If the principal does not have a configured limit the reservation succeeds
   * unconditionally (limit = Infinity). If a DegradedModeEvaluator is attached
   * and signals degraded, the reservation is still made but tagged `degraded: true`.
   *
   * @throws if the principal's available quota is insufficient (normal mode).
   */
  reserve(principal: string, route: string, upperBound: number): MeterReservation {
    const degradedResult = this.checkDegraded(principal);

    try {
      const r: Reservation = this.ledger.reserve(principal, route, upperBound);
      return {
        id: r.id,
        principal,
        route,
        upperBound,
        expiresAt: r.expiresAt,
        degraded: degradedResult.degraded,
      };
    } catch (err) {
      // In degraded mode we allow optimistic reservations even when the ledger
      // would reject (e.g. allowance store is stale). Re-throw in normal mode.
      if (degradedResult.degraded) {
        const expiresAt = this.clock() + 60_000;
        const degradedId = `rsv_deg_${principal}_${this.clock().toString(36)}`;
        return {
          id: degradedId,
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

  /**
   * Settle against actual usage; releases the unused portion of the hold.
   *
   * Returns warnings if any overage thresholds were crossed.
   */
  commit(reservationId: string, actual: number): MeterCommitResult {
    // Degraded reservations bypass the ledger.
    if (reservationId.startsWith('rsv_deg_')) {
      const parts = reservationId.split('_');
      const principal = parts[2] ?? 'unknown';
      this.windowStore.recordUsage(principal, this.clock(), actual);
      return { charged: actual, released: 0, warnings: [] };
    }

    const r = this.ledger.get(reservationId);
    if (!r) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    const { charged, released } = this.ledger.commit(reservationId, actual);

    // Record in the window store (fast path, in-memory).
    this.windowStore.recordUsage(r.principal, this.clock(), actual);

    // Evaluate overage warnings.
    const state = this.getOrCreateOverageState(r.principal);
    recordUsage(state, actual);
    const decision = evaluateOverage(state, 0); // 0 = not requesting more, just checking
    const warnings = decision.warnings.map((w) => w.message);

    return { charged, released, warnings };
  }

  /**
   * Return the full hold without charging anything.
   * Called when the upstream call failed.
   */
  release(reservationId: string): void {
    if (reservationId.startsWith('rsv_deg_')) {
      return; // Nothing to release for a degraded reservation.
    }
    this.ledger.release(reservationId);
  }

  /**
   * Return current usage for a principal.
   *
   * This is the fast path: a single Map lookup with no I/O. Target: < 1 ms.
   */
  read(principal: string): MeterReading {
    const { used, windowStart } = readCurrentWindow(this.windowStore, principal);
    const limit = this.store.limitFor(principal);
    const remaining = limit === Infinity ? Infinity : Math.max(0, limit - used);
    const degradedResult = this.checkDegraded(principal);

    return {
      principal,
      used,
      limit,
      remaining,
      windowStart,
      degraded: degradedResult.degraded,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private checkDegraded(principal: string): DegradedModeResult {
    if (!this.degradedEvaluator) {
      return { degraded: false, servicesToLimit: [] };
    }
    return this.degradedEvaluator.evaluate();
  }

  private getOrCreateOverageState(principal: string): OverageState {
    let state = this.overageStates.get(principal);
    if (!state) {
      const limit = this.store.limitFor(principal);
      state = createOverageState({
        limit: limit === Infinity ? 0 : limit,
      });
      this.overageStates.set(principal, state);
    }
    return state;
  }
}
