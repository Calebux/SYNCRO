export const ROUTE_UNITS = ['call', 'token', 'byte', 'second'] as const;

export type RouteUnit = (typeof ROUTE_UNITS)[number];

export function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
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

export function calculateChargeStroops(priceStroops: number, units: number): number {
  assertPositiveSafeInteger(priceStroops, 'priceStroops');
  assertPositiveSafeInteger(units, 'units');
  const amount = priceStroops * units;
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('charge exceeds the maximum safe integer stroops');
  }
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
