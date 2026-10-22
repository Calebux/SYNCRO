/**
 * Shared counter store for multi-instance metering (Issue #1442).
 *
 * The in-process `ReservationLedger` is safe within one gateway. Across
 * instances the check-then-decrement must be atomic or two gateways can
 * over-admit the same agent. This interface is that atomic boundary:
 * `reserve` checks balance and places a hold in one step.
 *
 * Behaviour when the store is unreachable is intentionally not defined here —
 * callers follow the degraded-mode design (Issue #1444).
 */

import { OverageError } from './errors';
import {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  resolveIdempotencyConfig,
  type IdempotencyConfig,
} from './idempotency';
import { DEFAULT_RESERVATION_TIMEOUT_MS } from './reservation';

export interface CounterStoreReservation {
  id: string;
  principal: string;
  route: string;
  upperBound: number;
  expiresAt: number;
}

export interface CounterStoreCommitResult {
  charged: number;
  released: number;
  /** True when an explicit idempotency key replayed a prior commit. */
  replayed?: boolean;
}

export interface CounterStoreReading {
  principal: string;
  used: number;
  limit: number;
  /** Outstanding holds (not yet committed or released). */
  held: number;
  /** limit - used - held, never negative (Infinity when unlimited). */
  remaining: number;
}

/**
 * Production counter store: atomic reserve / commit / release shared across
 * gateway instances.
 */
export interface CounterStore {
  setLimit(principal: string, limit: number): Promise<void>;
  reserve(
    principal: string,
    route: string,
    upperBound: number,
  ): Promise<CounterStoreReservation>;
  /**
   * Settle a hold. `idempotencyKey` (defaults to the reservation id) ensures a
   * retried commit does not double-count.
   */
  commit(
    reservationId: string,
    actual: number,
    idempotencyKey?: string,
  ): Promise<CounterStoreCommitResult>;
  release(reservationId: string): Promise<void>;
  read(principal: string): Promise<CounterStoreReading>;
  /** Lightweight reachability probe for readiness checks. */
  ping(): Promise<boolean>;
}

export interface CounterStoreOptions {
  /** Hold timeout in ms. Default: 60_000. */
  reservationTimeoutMs?: number;
  /** Clock for expiry; injectable for tests. */
  clock?: () => number;
  /** Idempotency-key TTL for committed usage. */
  idempotency?: Partial<IdempotencyConfig>;
}

export class CounterStoreUnavailableError extends Error {
  constructor(message = 'counter store unavailable', cause?: unknown) {
    super(message);
    this.name = 'CounterStoreUnavailableError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** Sentinel stored / returned for an unlimited principal. */
export const UNLIMITED_LIMIT = Number.POSITIVE_INFINITY;

let reservationSeq = 0;

export function nextReservationId(): string {
  return `rsv_${(reservationSeq += 1).toString(36)}_${Date.now().toString(36)}`;
}

export function resolveCounterStoreOptions(
  options: CounterStoreOptions = {},
): {
  reservationTimeoutMs: number;
  clock: () => number;
  idempotency: IdempotencyConfig;
} {
  return {
    reservationTimeoutMs:
      options.reservationTimeoutMs ?? DEFAULT_RESERVATION_TIMEOUT_MS,
    clock: options.clock ?? (() => Date.now()),
    idempotency: resolveIdempotencyConfig(options.idempotency),
  };
}

export function assertPositiveUpperBound(upperBound: number): void {
  if (!Number.isFinite(upperBound) || upperBound <= 0) {
    throw new RangeError(`upperBound must be positive, received ${upperBound}`);
  }
}

export function assertActualInHold(actual: number, upperBound: number): void {
  if (!Number.isFinite(actual) || actual < 0 || actual > upperBound) {
    throw new RangeError(
      `actual must be within [0, ${upperBound}], got ${actual}`,
    );
  }
}

export function insufficientAllowance(
  available: number,
  needed: number,
  limit: number,
): OverageError {
  return new OverageError(
    `Insufficient allowance: needed ${needed}, ${available} available`,
    available,
    needed,
    limit,
  );
}

export function notHeldError(id: string, state: string): Error {
  return new Error(`Reservation ${id} is ${state}, not held`);
}

export { DEFAULT_IDEMPOTENCY_TTL_MS };
