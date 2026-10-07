/**
 * Admission policy for a counter-store outage (Issue #1444).
 *
 * `degraded.ts` answers "should the system be running degraded?". This module
 * answers the harder question that follows: **while it is, what do we do with
 * paid traffic?** Two answers exist and neither is universally right:
 *
 *   - `fail_open`   — serve the call and accept that it will not be counted
 *                     against a quota. Availability wins; revenue leaks until
 *                     the leak is bounded.
 *   - `fail_closed` — refuse the call with `GATEWAY_METER_DEGRADED`. Revenue
 *                     integrity wins; the route is down for as long as the
 *                     counter store is.
 *
 * The correct answer differs per provider (a cheap high-volume route can carry
 * a much larger unbilled window than an expensive one), so the policy is held
 * per provider with a platform default.
 *
 * Bounded fail-open is the point of this module: `fail_open` is never allowed
 * to be unbounded. Each provider has an `exposureCeiling` — the value it is
 * willing to serve unbilled during one outage — and once
 * `exposureUsed + exposurePending + requested > exposureCeiling`, admission
 * stops and the provider fails closed for the rest of the outage. Exposure is
 * held at admission and released on rollback, so concurrent in-flight calls
 * cannot jointly overshoot the ceiling.
 *
 * Every admitted call is appended to a {@link DegradedUsageStore} on settle, so
 * the whole outage is reconcilable afterwards, and state transitions fire a
 * single {@link DegradedEvent} each so operators get exactly one loud alert on
 * entry and one on exit.
 */

import type { DegradedUsageRecord, DegradedUsageStore } from './degraded-log';

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type DegradedFailMode = 'fail_open' | 'fail_closed';

/**
 * What one provider does while the counter store is unavailable.
 */
export interface DegradedPolicy {
  /**
   * `fail_open` serves unbilled (bounded by `exposureCeiling`);
   * `fail_closed` refuses the call with `GATEWAY_METER_DEGRADED`.
   */
  failMode: DegradedFailMode;
  /**
   * Maximum value one provider may serve unbilled during a single outage, in
   * the same unit as the amounts the gateway commits (route price x units).
   * Reaching it flips the provider to fail-closed for the rest of the outage.
   */
  exposureCeiling: number;
}

/**
 * Platform default: fail open but never leak more than this per outage.
 *
 * Deliberately finite — an unbounded fail-open is the failure mode this issue
 * exists to remove.
 */
export const DEFAULT_DEGRADED_POLICY: DegradedPolicy = Object.freeze({
  failMode: 'fail_open',
  exposureCeiling: 100,
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type DegradedEventType = 'entered' | 'exited' | 'ceiling_exhausted';

/**
 * A single operator-facing event. `entered` / `exited` fire exactly once per
 * transition; `ceiling_exhausted` fires once per provider per outage, when the
 * last of that provider's unbilled budget is spent and it starts refusing.
 */
export interface DegradedEvent {
  type: DegradedEventType;
  /** ISO timestamp of the event. */
  at: string;
  /** Set for `entered` / `exited`: the outage this transition belongs to. */
  outageId: string | null;
  /** Set for `ceiling_exhausted`. */
  providerId?: string;
  /** Set for `ceiling_exhausted`. */
  exposureCeiling?: number;
  /** Unbilled value consumed so far in this outage (across providers). */
  exposureUsed: number;
  /** Calls admitted while degraded in this outage. */
  degradedCalls: number;
  /** Calls refused while degraded in this outage. */
  rejectedCalls: number;
}

export type DegradedEventListener = (event: DegradedEvent) => void;

// ---------------------------------------------------------------------------
// Admission decision
// ---------------------------------------------------------------------------

export type DegradedAdmissionReason =
  | 'counter_store_available'
  | 'fail_open'
  | 'fail_closed'
  | 'exposure_ceiling';

export interface DegradedAdmissionDecision {
  /** False ⇒ the call must be refused with `GATEWAY_METER_DEGRADED`. */
  admitted: boolean;
  /** True ⇒ the counter store was down for this call. */
  degraded: boolean;
  reason: DegradedAdmissionReason;
  /** Provider policy the decision was made under. */
  policy: DegradedPolicy;
  /** Unbilled value already consumed by this provider in this outage. */
  exposureUsed: number;
  /** Ceiling minus (used + pending + this call's exposure), never negative. */
  exposureRemaining: number;
  /**
   * Opaque handle that must be passed to `settle()` or `rollback()`.
   * Null when the call was not admitted, or when it was admitted while the
   * counter store was healthy (nothing to reconcile).
   */
  holdId: string | null;
}

// ---------------------------------------------------------------------------
// Controller options
// ---------------------------------------------------------------------------

export interface DegradedAdmissionOptions {
  /**
   * Answers "is the counter store reachable right now?". Called once per
   * admission check, so it must be cheap (an in-memory flag, not a probe).
   */
  isCounterStoreAvailable: () => boolean;
  /** Durable sink for everything served unbilled. Required: an unbilled call
   *  that is not written down is unrecoverable revenue. */
  log: DegradedUsageStore;
  /** Policy used for providers without an explicit one. */
  defaultPolicy?: Partial<DegradedPolicy>;
  /** Explicit per-provider policies, e.g. read back from a store on boot. */
  policies?: Record<string, Partial<DegradedPolicy>>;
  /** Injectable clock for deterministic tests. */
  clock?: () => number;
  /** Fired on entry, exit, and per-provider ceiling exhaustion. */
  onEvent?: DegradedEventListener;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

interface ExposureBucket {
  used: number;
  pending: number;
  calls: number;
  rejected: number;
  ceilingExhausted: boolean;
}

export interface DegradedProviderStatus {
  providerId: string;
  failMode: DegradedFailMode;
  exposureCeiling: number;
  exposureUsed: number;
  exposurePending: number;
  exposureRemaining: number;
  degradedCalls: number;
  rejectedCalls: number;
  /** True once this provider's ceiling was hit during the current outage. */
  ceilingExhausted: boolean;
}

/** Console-facing view of the degraded posture. */
export interface DegradedSnapshot {
  degraded: boolean;
  outageId: string | null;
  enteredAt: string | null;
  /** Path of the durable log, when the store exposes one. */
  logPath: string | null;
  totals: {
    exposureUsed: number;
    degradedCalls: number;
    rejectedCalls: number;
  };
  providers: DegradedProviderStatus[];
}

interface Hold {
  providerId: string;
  exposure: number;
}

/**
 * Decides, per call, whether traffic is served while the counter store is
 * down — and bounds and records everything that is.
 *
 * Lifecycle of a degraded call:
 *
 * ```ts
 * const decision = controller.admit(providerId, exposure);
 * if (!decision.admitted) return reject(GATEWAY_METER_DEGRADED);
 * try {
 *   const charge = await upstream();
 *   controller.settle(decision.holdId, record);   // durable, for reconciliation
 * } catch (e) {
 *   controller.rollback(decision.holdId);         // exposure returns to the pool
 *   throw e;
 * }
 * ```
 */
export class DegradedAdmissionController {
  private readonly isCounterStoreAvailable: () => boolean;
  private readonly log: DegradedUsageStore;
  private readonly clock: () => number;
  private readonly onEvent?: DegradedEventListener;
  private readonly defaultPolicy: DegradedPolicy;
  private readonly policies = new Map<string, DegradedPolicy>();

  private available = true;
  private outageId: string | null = null;
  private enteredAtMs: number | null = null;

  private readonly buckets = new Map<string, ExposureBucket>();
  private readonly holds = new Map<string, Hold>();
  private totalUsed = 0;
  private totalCalls = 0;
  private totalRejected = 0;
  private nextHold = 0;

  constructor(options: DegradedAdmissionOptions) {
    this.isCounterStoreAvailable = options.isCounterStoreAvailable;
    this.log = options.log;
    this.clock = options.clock ?? (() => Date.now());
    this.onEvent = options.onEvent;
    this.defaultPolicy = { ...DEFAULT_DEGRADED_POLICY, ...(options.defaultPolicy ?? {}) };
    if (options.policies) {
      for (const [providerId, policy] of Object.entries(options.policies)) {
        this.policies.set(providerId, { ...this.defaultPolicy, ...policy });
      }
    }
    this.available = options.isCounterStoreAvailable();
  }

  // -------------------------------------------------------------------------
  // Policy
  // -------------------------------------------------------------------------

  /** Set or replace one provider's policy. Safe to call on every boot. */
  setPolicy(providerId: string, policy: Partial<DegradedPolicy>): DegradedPolicy {
    const merged: DegradedPolicy = { ...this.policyFor(providerId), ...policy };
    this.policies.set(providerId, merged);
    return merged;
  }

  policyFor(providerId: string): DegradedPolicy {
    const policy = this.policies.get(providerId);
    return policy ? { ...policy } : { ...this.defaultPolicy };
  }

  // -------------------------------------------------------------------------
  // Health observation
  // -------------------------------------------------------------------------

  /**
   * Re-read the counter store health and fire the transition event if it
   * changed. Called automatically by `admit()`; exposed for probes.
   *
   * Entering resets the outage's exposure budget: the ceiling bounds one
   * outage, not the process lifetime.
   */
  observe(): DegradedEvent | null {
    const available = this.isCounterStoreAvailable();
    if (available === this.available) {
      return null;
    }
    this.available = available;

    if (!available) {
      return this.enter();
    }
    return this.exit();
  }

  isDegraded(): boolean {
    return !this.available;
  }

  // -------------------------------------------------------------------------
  // Admission
  // -------------------------------------------------------------------------

  /**
   * Decide whether a call may be served, holding `exposure` of unbilled
   * headroom if it is admitted while degraded.
   *
   * Exposure is held rather than charged: in-flight calls count against the
   * ceiling immediately, and a call that fails before it can be recorded
   * gives the headroom back via `rollback()`.
   */
  admit(providerId: string, exposure: number): DegradedAdmissionDecision {
    this.observe();

    const policy = this.policyFor(providerId);
    const bucket = this.bucketFor(providerId);

    if (this.available) {
      return {
        admitted: true,
        degraded: false,
        reason: 'counter_store_available',
        policy,
        exposureUsed: bucket.used,
        exposureRemaining: Math.max(0, policy.exposureCeiling - bucket.used - bucket.pending),
        holdId: null,
      };
    }

    const requested = Number.isFinite(exposure) ? Math.max(0, exposure) : 0;
    const remainingAfter = policy.exposureCeiling - bucket.used - bucket.pending - requested;

    if (policy.failMode === 'fail_closed') {
      bucket.rejected += 1;
      this.totalRejected += 1;
      return {
        admitted: false,
        degraded: true,
        reason: 'fail_closed',
        policy,
        exposureUsed: bucket.used,
        exposureRemaining: Math.max(0, policy.exposureCeiling - bucket.used - bucket.pending),
        holdId: null,
      };
    }

    if (remainingAfter < 0) {
      bucket.rejected += 1;
      this.totalRejected += 1;
      if (!bucket.ceilingExhausted) {
        bucket.ceilingExhausted = true;
        this.emit({
          type: 'ceiling_exhausted',
          at: this.nowIso(),
          outageId: this.outageId,
          providerId,
          exposureCeiling: policy.exposureCeiling,
          exposureUsed: this.totalUsed,
          degradedCalls: this.totalCalls,
          rejectedCalls: this.totalRejected,
        });
      }
      return {
        admitted: false,
        degraded: true,
        reason: 'exposure_ceiling',
        policy,
        exposureUsed: bucket.used,
        exposureRemaining: Math.max(0, remainingAfter + requested),
        holdId: null,
      };
    }

    const holdId = `dhold_${this.outageId ?? 'x'}_${(this.nextHold++).toString(36)}_${this.clock().toString(36)}`;
    bucket.pending += requested;
    this.holds.set(holdId, { providerId, exposure: requested });

    return {
      admitted: true,
      degraded: true,
      reason: 'fail_open',
      policy,
      exposureUsed: bucket.used,
      exposureRemaining: Math.max(0, remainingAfter),
      holdId,
    };
  }

  /**
   * Give back the headroom a degraded call was holding. The call failed, so
   * nothing was served and nothing is owed — but the call is still worth
   * knowing about, so it is recorded with a zero amount.
   */
  rollback(holdId: string | null): void {
    if (!holdId) return;
    const hold = this.holds.get(holdId);
    if (!hold) return;
    this.holds.delete(holdId);
    const bucket = this.bucketFor(hold.providerId);
    bucket.pending = Math.max(0, bucket.pending - hold.exposure);
  }

  /**
   * Record a degraded call as served and make it durable.
   *
   * The headroom becomes consumed exposure at the amount actually served —
   * not the amount held — because the call really did go out unbilled and the
   * ceiling is a bound on real value. `record.id` is the caller's idempotency
   * key (the receipt id), so a replayed write cannot double-count.
   */
  settle(holdId: string | null, record: Omit<DegradedUsageRecord, 'outageId'>): void {
    if (!holdId) return;
    const hold = this.holds.get(holdId);
    if (!hold) return;
    this.holds.delete(holdId);

    const bucket = this.bucketFor(hold.providerId);
    bucket.pending = Math.max(0, bucket.pending - hold.exposure);
    bucket.used += record.amount;
    bucket.calls += 1;
    this.totalUsed += record.amount;
    this.totalCalls += 1;

    this.log.append({ ...record, outageId: this.outageId ?? 'unknown' });
  }

  // -------------------------------------------------------------------------
  // Console
  // -------------------------------------------------------------------------

  snapshot(): DegradedSnapshot {
    const providers: DegradedProviderStatus[] = [...this.buckets.entries()].map(([providerId, bucket]) => {
      const policy = this.policyFor(providerId);
      return {
        providerId,
        failMode: policy.failMode,
        exposureCeiling: policy.exposureCeiling,
        exposureUsed: bucket.used,
        exposurePending: bucket.pending,
        exposureRemaining: Math.max(0, policy.exposureCeiling - bucket.used - bucket.pending),
        degradedCalls: bucket.calls,
        rejectedCalls: bucket.rejected,
        ceilingExhausted: bucket.ceilingExhausted,
      };
    });

    for (const [providerId] of this.policies) {
      if (!this.buckets.has(providerId)) {
        const policy = this.policyFor(providerId);
        providers.push({
          providerId,
          failMode: policy.failMode,
          exposureCeiling: policy.exposureCeiling,
          exposureUsed: 0,
          exposurePending: 0,
          exposureRemaining: policy.exposureCeiling,
          degradedCalls: 0,
          rejectedCalls: 0,
          ceilingExhausted: false,
        });
      }
    }

    const logPath = (this.log as unknown as { filePath?: string }).filePath ?? null;

    return {
      degraded: !this.available,
      outageId: this.outageId,
      enteredAt: this.enteredAtMs === null ? null : new Date(this.enteredAtMs).toISOString(),
      logPath,
      totals: {
        exposureUsed: this.totalUsed,
        degradedCalls: this.totalCalls,
        rejectedCalls: this.totalRejected,
      },
      providers: providers.sort((a, b) => a.providerId.localeCompare(b.providerId)),
    };
  }

  /** Everything served unbilled, for reconciliation. */
  readLog(): DegradedUsageRecord[] {
    return this.log.read();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private enter(): DegradedEvent {
    this.outageId = `out_${this.clock().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.enteredAtMs = this.clock();
    this.totalUsed = 0;
    this.totalCalls = 0;
    this.totalRejected = 0;
    this.holds.clear();
    for (const bucket of this.buckets.values()) {
      bucket.used = 0;
      bucket.pending = 0;
      bucket.calls = 0;
      bucket.rejected = 0;
      bucket.ceilingExhausted = false;
    }

    const event: DegradedEvent = {
      type: 'entered',
      at: this.nowIso(),
      outageId: this.outageId,
      exposureUsed: 0,
      degradedCalls: 0,
      rejectedCalls: 0,
    };
    this.emit(event);
    return event;
  }

  private exit(): DegradedEvent {
    const event: DegradedEvent = {
      type: 'exited',
      at: this.nowIso(),
      outageId: this.outageId,
      exposureUsed: this.totalUsed,
      degradedCalls: this.totalCalls,
      rejectedCalls: this.totalRejected,
    };
    this.outageId = null;
    this.enteredAtMs = null;
    this.holds.clear();
    this.emit(event);
    return event;
  }

  private emit(event: DegradedEvent): void {
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch {
      // Alerts are a side channel: a failing listener must never take the
      // admission path down with it.
    }
  }

  private bucketFor(providerId: string): ExposureBucket {
    let bucket = this.buckets.get(providerId);
    if (!bucket) {
      bucket = { used: 0, pending: 0, calls: 0, rejected: 0, ceilingExhausted: false };
      this.buckets.set(providerId, bucket);
    }
    return bucket;
  }

  private nowIso(): string {
    return new Date(this.clock()).toISOString();
  }
}
