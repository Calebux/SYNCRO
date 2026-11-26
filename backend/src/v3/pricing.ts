export const ROUTE_UNITS = ['call', 'token', 'byte', 'second'] as const;

export type RouteUnit = (typeof ROUTE_UNITS)[number];

export const DEFAULT_QUOTE_TTL_SECONDS = 60;

export interface RateCardRoute {
  method: string;
  path: string;
  unit: RouteUnit;
  priceStroops: number;
}

export interface RateCard {
  version: string;
  asset: string;
  routes: readonly RateCardRoute[];
}

export interface QuoteSizeHint {
  unit?: RouteUnit;
  quantity?: number;
}

export interface ResolvedRoutePrice {
  route: RateCardRoute;
  unit: RouteUnit;
  priceStroops: number;
  asset: string;
  rateCardVersion: string;
}

export interface RouteQuote extends ResolvedRoutePrice {
  units: number;
  amountStroops: number;
  expiresAt: string;
}

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    throw new Error(`route path must start with "/": ${path}`);
  }
  return trimmed.length > 1 && trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function resolveRoutePrice(
  rateCard: RateCard,
  method: string,
  path: string,
  sizeHint?: QuoteSizeHint,
): ResolvedRoutePrice {
  const normalizedMethod = normalizeMethod(method);
  const normalizedPath = normalizePath(path);
  const route = rateCard.routes.find(
    (candidate) =>
      normalizeMethod(candidate.method) === normalizedMethod &&
      normalizePath(candidate.path) === normalizedPath,
  );
  if (!route) {
    throw new Error(`no rate card entry for ${normalizedMethod} ${normalizedPath}`);
  }
  assertPositiveSafeInteger(route.priceStroops, 'priceStroops');
  if (sizeHint?.unit !== undefined && sizeHint.unit !== route.unit) {
    throw new Error(
      `size hint unit ${sizeHint.unit} does not match route unit ${route.unit}`,
    );
  }
  return {
    route,
    unit: route.unit,
    priceStroops: route.priceStroops,
    asset: rateCard.asset,
    rateCardVersion: rateCard.version,
  };
}

export function calculateQuotedUnits(
  resolved: ResolvedRoutePrice,
  sizeHint?: QuoteSizeHint,
): number {
  if (resolved.unit === 'call') {
    return 1;
  }
  if (sizeHint?.quantity === undefined) {
    throw new Error(`a size hint quantity is required for ${resolved.unit}-priced routes`);
  }
  return roundBillableUnits(sizeHint.quantity);
}

export function buildRouteQuote(
  rateCard: RateCard,
  method: string,
  path: string,
  sizeHint?: QuoteSizeHint,
  now: Date = new Date(),
  ttlSeconds: number = DEFAULT_QUOTE_TTL_SECONDS,
): RouteQuote {
  assertPositiveSafeInteger(ttlSeconds, 'ttlSeconds');
  const resolved = resolveRoutePrice(rateCard, method, path, sizeHint);
  const units = calculateQuotedUnits(resolved, sizeHint);
  const amountStroops = calculateChargeStroops(resolved.priceStroops, units);
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  return { ...resolved, units, amountStroops, expiresAt };
}

export function isQuoteExpired(expiresAt: string, now: Date = new Date()): boolean {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) {
    throw new Error(`invalid quote expiry: ${expiresAt}`);
  }
  return now.getTime() >= expiry;
}

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
