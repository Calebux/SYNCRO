/**
 * Reserve / commit / release for a metered call (Issue #1441).
 *
 * Allowance is held at admission against an upper bound, then settled against
 * the actual. Holding at admission is what stops two concurrent calls each
 * passing a check the other is about to invalidate.
 *
 * Expiry releases rather than charges: with neither commit nor release we do
 * not know the upstream call happened, and billing unproven work is the worse
 * error.
 */

import type { Principal } from './policy';

export type ReservationState = 'held' | 'committed' | 'released' | 'expired';

export interface Reservation {
  id: string;
  principal: Principal;
  route: string;
  upperBound: number;
  state: ReservationState;
  expiresAt: number;
}

export interface AllowanceStore {
  limitFor(principal: Principal): number;
  usedBy(principal: Principal): number;
  /** Must be idempotent per reservation id. */
  recordUsage(principal: Principal, amount: number, reservationId: string): void;
}

export const DEFAULT_RESERVATION_TIMEOUT_MS = 60_000;

let counter = 0;

export class ReservationLedger {
  private readonly holds = new Map<string, Reservation>();

  constructor(
    private readonly store: AllowanceStore,
    private readonly timeoutMs = DEFAULT_RESERVATION_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Limit minus committed usage minus outstanding holds. */
  availableFor(principal: Principal): number {
    let holds = 0;
    for (const r of this.holds.values()) {
      if (r.state === 'held' && r.principal === principal) holds += r.upperBound;
    }
    return Math.max(0, this.store.limitFor(principal) - this.store.usedBy(principal) - holds);
  }

  reserve(principal: Principal, route: string, upperBound: number): Reservation {
    if (!Number.isFinite(upperBound) || upperBound <= 0) {
      throw new RangeError(`upperBound must be positive, received ${upperBound}`);
    }
    this.sweep();
    const available = this.availableFor(principal);
    if (upperBound > available) {
      throw new Error(`Insufficient allowance: needed ${upperBound}, ${available} available`);
    }
    const r: Reservation = {
      id: `rsv_${(counter += 1).toString(36)}`,
      principal,
      route,
      upperBound,
      state: 'held',
      expiresAt: this.now() + this.timeoutMs,
    };
    this.holds.set(r.id, r);
    return { ...r };
  }

  /** Settles against real usage, releasing the unused difference. */
  commit(id: string, actual: number): { charged: number; released: number } {
    const r = this.requireHeld(id);
    if (!Number.isFinite(actual) || actual < 0 || actual > r.upperBound) {
      throw new RangeError(`actual must be within [0, ${r.upperBound}], got ${actual}`);
    }
    r.state = 'committed';
    this.store.recordUsage(r.principal, actual, r.id);
    return { charged: actual, released: r.upperBound - actual };
  }

  /** Returns the whole hold, recording no usage — a failed call is not a cheap call. */
  release(id: string): void {
    this.requireHeld(id).state = 'released';
  }

  /** Releases every hold past its expiry. Called automatically by `reserve`. */
  sweep(): Reservation[] {
    const now = this.now();
    const expired: Reservation[] = [];
    for (const r of this.holds.values()) {
      if (r.state === 'held' && r.expiresAt <= now) {
        r.state = 'expired';
        expired.push({ ...r });
      }
    }
    return expired;
  }

  /** Interval sweeper, for holds that would otherwise sit through a quiet period. */
  startSweeper(intervalMs = this.timeoutMs): () => void {
    const t = setInterval(() => this.sweep(), intervalMs);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }

  get(id: string): Reservation | undefined {
    return this.holds.get(id);
  }

  /** Sweeps first, so a late commit fails loudly instead of mis-billing. */
  private requireHeld(id: string): Reservation {
    this.sweep();
    const r = this.holds.get(id);
    if (!r || r.state !== 'held') {
      throw new Error(`Reservation ${id} is ${r?.state ?? 'unknown'}, not held`);
    }
    return r;
  }
}
