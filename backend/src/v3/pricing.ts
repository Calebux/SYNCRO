export const ROUTE_UNITS = ['call', 'token', 'byte', 'second'] as const;

export type RouteUnit = (typeof ROUTE_UNITS)[number];

/** A marginal price band. null means the final band has no upper limit. */
export interface PricingTier {
  upToUnits: number | null;
  priceStroops: number;
}

export interface PricingSchedule {
  /** Number of units included free on each paid call. */
  freeUnits?: number;
  /** Marginal bands applied after the free units have been consumed. */
  tiers?: PricingTier[];
}

export function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

export function validatePricingSchedule(schedule: PricingSchedule, fallbackPriceStroops: number): void {
  assertPositiveSafeInteger(fallbackPriceStroops, 'priceStroops');
  const freeUnits = schedule.freeUnits ?? 0;
  if (!Number.isSafeInteger(freeUnits) || freeUnits < 0) {
    throw new RangeError('freeUnits must be a non-negative safe integer');
  }
  if (schedule.tiers === undefined) return;
  if (!Array.isArray(schedule.tiers) || schedule.tiers.length === 0) {
    throw new RangeError('tiers must contain at least one pricing tier');
  }
  let previousLimit = 0;
  schedule.tiers.forEach((tier, index) => {
    assertPositiveSafeInteger(tier.priceStroops, `tiers[${index}].priceStroops`);
    if (tier.upToUnits === null) {
      if (index !== schedule.tiers!.length - 1) {
        throw new RangeError('only the final pricing tier may have an unlimited upper bound');
      }
    } else {
      assertPositiveSafeInteger(tier.upToUnits, `tiers[${index}].upToUnits`);
      if (tier.upToUnits <= previousLimit) {
        throw new RangeError('tier upper bounds must be strictly increasing');
      }
      previousLimit = tier.upToUnits;
    }
  });
  if (schedule.tiers[schedule.tiers.length - 1].upToUnits !== null) {
    throw new RangeError('the final pricing tier must have an unlimited upper bound');
  }
}

export function roundBillableUnits(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new RangeError('measured quantity must be a finite non-negative number');
  }
  const rounded = Math.max(1, Math.ceil(quantity));
  assertPositiveSafeInteger(rounded, 'billable units');
  return rounded;
}

/**
 * Calculate the gateway charge using integer stroops. Tiers are marginal:
 * each tier price applies only to units above the preceding tier boundary.
 * Free units are deducted before applying the paid tiers.
 */
export function calculateChargeStroops(
  priceStroops: number,
  units: number,
  schedule: PricingSchedule = {},
): number {
  assertPositiveSafeInteger(priceStroops, 'priceStroops');
  assertPositiveSafeInteger(units, 'units');
  validatePricingSchedule(schedule, priceStroops);
  const billableUnits = Math.max(0, units - (schedule.freeUnits ?? 0));
  if (billableUnits === 0) return 0;

  const tiers = schedule.tiers ?? [{ upToUnits: null, priceStroops }];
  let remaining = billableUnits;
  let previousLimit = 0;
  let amount = 0;
  for (const tier of tiers) {
    const capacity = tier.upToUnits === null ? remaining : Math.min(remaining, tier.upToUnits - previousLimit);
    const tierAmount = capacity * tier.priceStroops;
    if (!Number.isSafeInteger(tierAmount) || !Number.isSafeInteger(amount + tierAmount)) {
      throw new RangeError('charge exceeds the maximum safe integer stroops');
    }
    amount += tierAmount;
    remaining -= capacity;
    if (remaining === 0) break;
    if (tier.upToUnits !== null) previousLimit = tier.upToUnits;
  }
  if (remaining > 0) throw new RangeError('pricing tiers do not cover all billable units');
  return amount;
}

export function extractMeasuredQuantity(extractor: string, responseBody: unknown): number {
  if (extractor === 'constant:1') return 1;

  const segments = extractor.match(/^\$\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/)?.[1]
    .split('.');
  if (!segments || typeof responseBody !== 'object' || responseBody === null) {
    throw new Error(`unsupported quantity extractor: ${extractor}`);
  }

  let value: unknown = responseBody;
  for (const segment of segments) {
    if (typeof value !== 'object' || value === null || !(segment in value)) {
      throw new Error(`quantity extractor did not resolve: ${extractor}`);
    }
    value = (value as Record<string, unknown>)[segment];
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`quantity extractor must resolve to a finite non-negative number: ${extractor}`);
  }
  return value;
}
