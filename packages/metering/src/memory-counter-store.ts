/**
 * In-process CounterStore with a mutex so concurrent reserves cannot over-admit.
 *
 * Used as the reference implementation for the CounterStore contract suite and
 * for single-instance deployments that do not need Redis.
 */

import {
  assertActualInHold,
  assertPositiveUpperBound,
  insufficientAllowance,
  nextReservationId,
  notHeldError,
  resolveCounterStoreOptions,
  UNLIMITED_LIMIT,
  type CounterStore,
  type CounterStoreCommitResult,
  type CounterStoreOptions,
  type CounterStoreReading,
  type CounterStoreReservation,
} from './counter-store';

interface Hold {
  id: string;
  principal: string;
  route: string;
  upperBound: number;
  expiresAt: number;
  state: 'held' | 'committed' | 'released' | 'expired';
}

interface Account {
  limit: number;
  used: number;
}

interface AppliedCommit {
  charged: number;
  released: number;
  expiresAt: number;
}

/**
 * Serialises mutations through a promise chain so overlapping `reserve` calls
 * observe one another — the same single-threaded guarantee Redis Lua provides.
 */
export class InMemoryCounterStore implements CounterStore {
  private readonly accounts = new Map<string, Account>();
  private readonly holds = new Map<string, Hold>();
  private readonly applied = new Map<string, AppliedCommit>();
  private readonly reservationTimeoutMs: number;
  private readonly clock: () => number;
  private readonly idempotencyTtlMs: number;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: CounterStoreOptions = {}) {
    const resolved = resolveCounterStoreOptions(options);
    this.reservationTimeoutMs = resolved.reservationTimeoutMs;
    this.clock = resolved.clock;
    this.idempotencyTtlMs = resolved.idempotency.ttlMs;
  }

  private async serial<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private account(principal: string): Account {
    let acct = this.accounts.get(principal);
    if (!acct) {
      acct = { limit: UNLIMITED_LIMIT, used: 0 };
      this.accounts.set(principal, acct);
    }
    return acct;
  }

  private sweepExpired(now: number): void {
    for (const hold of this.holds.values()) {
      if (hold.state === 'held' && hold.expiresAt <= now) {
        hold.state = 'expired';
      }
    }
    for (const [key, applied] of this.applied) {
      if (applied.expiresAt <= now) this.applied.delete(key);
    }
  }

  private heldFor(principal: string): number {
    let held = 0;
    for (const h of this.holds.values()) {
      if (h.state === 'held' && h.principal === principal) held += h.upperBound;
    }
    return held;
  }

  async setLimit(principal: string, limit: number): Promise<void> {
    return this.serial(() => {
      if (!Number.isFinite(limit) || limit < 0) {
        throw new RangeError(`limit must be a non-negative finite number, got ${limit}`);
      }
      this.account(principal).limit = limit;
    });
  }

  async reserve(
    principal: string,
    route: string,
    upperBound: number,
  ): Promise<CounterStoreReservation> {
    return this.serial(() => {
      assertPositiveUpperBound(upperBound);
      const now = this.clock();
      this.sweepExpired(now);
      const acct = this.account(principal);
      const held = this.heldFor(principal);
      const available =
        acct.limit === UNLIMITED_LIMIT
          ? UNLIMITED_LIMIT
          : Math.max(0, acct.limit - acct.used - held);
      if (upperBound > available) {
        throw insufficientAllowance(available, upperBound, acct.limit);
      }
      const id = nextReservationId();
      const expiresAt = now + this.reservationTimeoutMs;
      this.holds.set(id, {
        id,
        principal,
        route,
        upperBound,
        expiresAt,
        state: 'held',
      });
      return { id, principal, route, upperBound, expiresAt };
    });
  }

  async commit(
    reservationId: string,
    actual: number,
    idempotencyKey?: string,
  ): Promise<CounterStoreCommitResult> {
    return this.serial(() => {
      const now = this.clock();
      this.sweepExpired(now);

      // Explicit retry key: return the prior result without requiring the hold
      // to still be open (SDK retries after a lost response).
      if (idempotencyKey) {
        const prior = this.applied.get(idempotencyKey);
        if (prior) {
          return {
            charged: prior.charged,
            released: prior.released,
            replayed: true,
          };
        }
      }

      const hold = this.holds.get(reservationId);
      if (!hold || hold.state !== 'held') {
        throw notHeldError(reservationId, hold?.state ?? 'unknown');
      }
      assertActualInHold(actual, hold.upperBound);

      hold.state = 'committed';
      const acct = this.account(hold.principal);
      // Guard against double-count even if state were raced (mirrors Redis).
      if (!this.applied.has(reservationId)) {
        acct.used += actual;
      }
      const result = { charged: actual, released: hold.upperBound - actual };
      const entry: AppliedCommit = {
        ...result,
        expiresAt: now + this.idempotencyTtlMs,
      };
      this.applied.set(reservationId, entry);
      if (idempotencyKey) this.applied.set(idempotencyKey, entry);
      return result;
    });
  }

  async release(reservationId: string): Promise<void> {
    return this.serial(() => {
      const now = this.clock();
      this.sweepExpired(now);
      const hold = this.holds.get(reservationId);
      if (!hold || hold.state !== 'held') {
        throw notHeldError(reservationId, hold?.state ?? 'unknown');
      }
      hold.state = 'released';
    });
  }

  async read(principal: string): Promise<CounterStoreReading> {
    return this.serial(() => {
      this.sweepExpired(this.clock());
      const acct = this.account(principal);
      const held = this.heldFor(principal);
      const remaining =
        acct.limit === UNLIMITED_LIMIT
          ? UNLIMITED_LIMIT
          : Math.max(0, acct.limit - acct.used - held);
      return {
        principal,
        used: acct.used,
        limit: acct.limit,
        held,
        remaining,
      };
    });
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
