export type BillingUnit = 'call' | 'token' | 'byte' | 'second';

export interface RouteRate {
  routeId: string;
  endpoint: string;
  unit: BillingUnit;
  pricePerUnitStroops: bigint;
  minimumBillableUnits: bigint;
}

export interface RateCard {
  providerId: string;
  version: string;
  effectiveFrom: number;
  effectiveUntil?: number;
  routes: readonly RouteRate[];
}

export interface UsageQuantity {
  numerator: bigint;
  denominator: bigint;
}

export interface ResolvedRouteRate extends RouteRate {
  providerId: string;
  rateCardVersion: string;
}

export interface StroopAllowanceStore {
  limitFor(principal: string): bigint;
  usedBy(principal: string): bigint;
  recordUsage(principal: string, amountStroops: bigint, reservationId: string): void;
}

export type PricedReservationState = 'held' | 'committed' | 'released' | 'expired';

export interface PricedReservation {
  id: string;
  principal: string;
  providerId: string;
  routeId: string;
  unit: BillingUnit;
  rateCardVersion: string;
  pricePerUnitStroops: bigint;
  minimumBillableUnits: bigint;
  upperBoundUnits: bigint;
  upperBoundStroops: bigint;
  state: PricedReservationState;
  expiresAt: number;
}

export interface PricedCommitResult {
  chargedStroops: bigint;
  releasedStroops: bigint;
  billableUnits: bigint;
  rateCardVersion: string;
}

export const DEFAULT_PRICED_RESERVATION_TIMEOUT_MS = 60_000;

let reservationCounter = 0n;

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertNonNegative(value: bigint, name: string): void {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new RangeError(`${name} must be a non-negative bigint`);
  }
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer timestamp`);
  }
}

function cardEnd(card: RateCard): number {
  return card.effectiveUntil ?? Number.POSITIVE_INFINITY;
}

function validateRouteRate(rate: RouteRate): void {
  assertNonEmpty(rate.routeId, 'routeId');
  assertNonEmpty(rate.endpoint, 'endpoint');
  if (!['call', 'token', 'byte', 'second'].includes(rate.unit)) {
    throw new TypeError(`Unsupported billing unit: ${String(rate.unit)}`);
  }
  assertNonNegative(rate.pricePerUnitStroops, 'pricePerUnitStroops');
  if (rate.minimumBillableUnits <= 0n) {
    throw new RangeError('minimumBillableUnits must be a positive bigint');
  }
}

/**
 * Stores immutable, non-overlapping provider rate-card versions. Effective
 * intervals are [effectiveFrom, effectiveUntil); an omitted end is open-ended.
 */
export class RateCardCatalog {
  private readonly cardsByProvider = new Map<string, RateCard[]>();

  publish(card: RateCard): void {
    assertNonEmpty(card.providerId, 'providerId');
    assertNonEmpty(card.version, 'version');
    assertTimestamp(card.effectiveFrom, 'effectiveFrom');
    if (card.effectiveUntil !== undefined) {
      assertTimestamp(card.effectiveUntil, 'effectiveUntil');
      if (card.effectiveUntil <= card.effectiveFrom) {
        throw new RangeError('effectiveUntil must be later than effectiveFrom');
      }
    }
    if (card.routes.length === 0) {
      throw new RangeError('A rate card must contain at least one route');
    }

    const routeIds = new Set<string>();
    for (const route of card.routes) {
      validateRouteRate(route);
      if (routeIds.has(route.routeId)) {
        throw new Error(`Duplicate route '${route.routeId}' in rate card`);
      }
      routeIds.add(route.routeId);
    }

    const existing = this.cardsByProvider.get(card.providerId) ?? [];
    if (existing.some((item) => item.version === card.version)) {
      throw new Error(`Rate-card version '${card.version}' already exists for provider '${card.providerId}'`);
    }
    if (existing.some((item) => card.effectiveFrom < cardEnd(item) && item.effectiveFrom < cardEnd(card))) {
      throw new Error(`Rate-card effective period overlaps another version for provider '${card.providerId}'`);
    }

    const immutableCard: RateCard = {
      ...card,
      routes: card.routes.map((route) => Object.freeze({ ...route })),
    };
    Object.freeze(immutableCard.routes);
    const updated = [...existing, Object.freeze(immutableCard)]
      .sort((left, right) => left.effectiveFrom - right.effectiveFrom);
    this.cardsByProvider.set(card.providerId, updated);
  }

  resolve(providerId: string, routeId: string, at: number): ResolvedRouteRate {
    assertNonEmpty(providerId, 'providerId');
    assertNonEmpty(routeId, 'routeId');
    assertTimestamp(at, 'at');
    const card = (this.cardsByProvider.get(providerId) ?? []).find(
      (candidate) => candidate.effectiveFrom <= at && at < cardEnd(candidate),
    );
    if (!card) {
      throw new Error(`No effective rate card for provider '${providerId}' at ${at}`);
    }
    const route = card.routes.find((candidate) => candidate.routeId === routeId);
    if (!route) {
      throw new Error(`Route '${routeId}' is not priced by provider '${providerId}' rate card '${card.version}'`);
    }
    return { ...route, providerId, rateCardVersion: card.version };
  }
}

/**
 * Converts an exact rational usage quantity to billable whole units.
 * Fractional units always round up, then the configured minimum is applied.
 */
export function billableUnits(quantity: UsageQuantity, minimumBillableUnits: bigint): bigint {
  if (typeof quantity.numerator !== 'bigint' || quantity.numerator < 0n) {
    throw new RangeError('quantity.numerator must be a non-negative bigint');
  }
  if (typeof quantity.denominator !== 'bigint' || quantity.denominator <= 0n) {
    throw new RangeError('quantity.denominator must be a positive bigint');
  }
  if (typeof minimumBillableUnits !== 'bigint' || minimumBillableUnits <= 0n) {
    throw new RangeError('minimumBillableUnits must be a positive bigint');
  }
  const roundedUnits = (quantity.numerator + quantity.denominator - 1n) / quantity.denominator;
  return roundedUnits > minimumBillableUnits ? roundedUnits : minimumBillableUnits;
}

export function priceUsage(rate: RouteRate, quantity: UsageQuantity): { billableUnits: bigint; amountStroops: bigint } {
  validateRouteRate(rate);
  const units = billableUnits(quantity, rate.minimumBillableUnits);
  return { billableUnits: units, amountStroops: units * rate.pricePerUnitStroops };
}

/**
 * Reserves a priced upper bound before execution and settles the captured
 * version at actual usage. The allowance store and all monetary arithmetic use
 * bigint stroops; no floating-point money conversions are performed.
 */
export class PricedCallAdmission {
  private readonly reservations = new Map<string, PricedReservation>();

  constructor(
    private readonly catalog: RateCardCatalog,
    private readonly store: StroopAllowanceStore,
    private readonly timeoutMs = DEFAULT_PRICED_RESERVATION_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive safe integer');
    }
  }

  availableFor(principal: string): bigint {
    let outstanding = 0n;
    for (const reservation of this.reservations.values()) {
      if (reservation.principal === principal && reservation.state === 'held') {
        outstanding += reservation.upperBoundStroops;
      }
    }
    const available = this.store.limitFor(principal) - this.store.usedBy(principal) - outstanding;
    return available > 0n ? available : 0n;
  }

  reserve(
    principal: string,
    providerId: string,
    routeId: string,
    upperBoundQuantity: UsageQuantity,
    at = this.now(),
  ): PricedReservation {
    assertNonEmpty(principal, 'principal');
    this.sweep();
    const rate = this.catalog.resolve(providerId, routeId, at);
    const pricedUpperBound = priceUsage(rate, upperBoundQuantity);
    const available = this.availableFor(principal);
    if (pricedUpperBound.amountStroops > available) {
      throw new Error(`Insufficient allowance: needed ${pricedUpperBound.amountStroops} stroops, ${available} available`);
    }

    const reservation: PricedReservation = {
      id: `price_rsv_${(++reservationCounter).toString(36)}`,
      principal,
      providerId,
      routeId,
      unit: rate.unit,
      rateCardVersion: rate.rateCardVersion,
      pricePerUnitStroops: rate.pricePerUnitStroops,
      minimumBillableUnits: rate.minimumBillableUnits,
      upperBoundUnits: pricedUpperBound.billableUnits,
      upperBoundStroops: pricedUpperBound.amountStroops,
      state: 'held',
      expiresAt: this.now() + this.timeoutMs,
    };
    this.reservations.set(reservation.id, reservation);
    return { ...reservation };
  }

  commit(id: string, actualQuantity: UsageQuantity): PricedCommitResult {
    const reservation = this.requireHeld(id);
    const actual = priceUsage(reservation, actualQuantity);
    if (actual.amountStroops > reservation.upperBoundStroops) {
      throw new RangeError(
        `Actual cost ${actual.amountStroops} stroops exceeds reserved upper bound ${reservation.upperBoundStroops}`,
      );
    }
    this.store.recordUsage(reservation.principal, actual.amountStroops, reservation.id);
    reservation.state = 'committed';
    return {
      chargedStroops: actual.amountStroops,
      releasedStroops: reservation.upperBoundStroops - actual.amountStroops,
      billableUnits: actual.billableUnits,
      rateCardVersion: reservation.rateCardVersion,
    };
  }

  release(id: string): void {
    this.requireHeld(id).state = 'released';
  }

  sweep(): PricedReservation[] {
    const currentTime = this.now();
    const expired: PricedReservation[] = [];
    for (const reservation of this.reservations.values()) {
      if (reservation.state === 'held' && reservation.expiresAt <= currentTime) {
        reservation.state = 'expired';
        expired.push({ ...reservation });
      }
    }
    return expired;
  }

  get(id: string): PricedReservation | undefined {
    const reservation = this.reservations.get(id);
    return reservation ? { ...reservation } : undefined;
  }

  private requireHeld(id: string): PricedReservation {
    this.sweep();
    const reservation = this.reservations.get(id);
    if (!reservation || reservation.state !== 'held') {
      throw new Error(`Priced reservation ${id} is ${reservation?.state ?? 'unknown'}, not held`);
    }
    return reservation;
  }
}

export class InMemoryStroopAllowanceStore implements StroopAllowanceStore {
  private readonly limits = new Map<string, bigint>();
  private readonly usage = new Map<string, bigint>();
  private readonly appliedReservations = new Set<string>();

  setLimit(principal: string, limitStroops: bigint): void {
    assertNonEmpty(principal, 'principal');
    assertNonNegative(limitStroops, 'limitStroops');
    this.limits.set(principal, limitStroops);
  }

  limitFor(principal: string): bigint {
    return this.limits.get(principal) ?? 0n;
  }

  usedBy(principal: string): bigint {
    return this.usage.get(principal) ?? 0n;
  }

  recordUsage(principal: string, amountStroops: bigint, reservationId: string): void {
    assertNonNegative(amountStroops, 'amountStroops');
    if (this.appliedReservations.has(reservationId)) return;
    this.appliedReservations.add(reservationId);
    this.usage.set(principal, this.usedBy(principal) + amountStroops);
  }
}
