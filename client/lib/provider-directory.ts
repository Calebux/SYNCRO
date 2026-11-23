/**
 * Provider directory client (#1863).
 *
 * Console side of the public provider directory API (#1829): a browsable
 * catalogue where principals find paid APIs and copy integration snippets.
 *
 * Everything the pages need that is not rendering lives here as pure helpers
 * (filtering, opt-in enforcement, uptime classification, example-call
 * building) so it can be unit tested without a DOM.
 *
 * API contract assumed from #1829 (public, read-only, unauthenticated):
 *   GET {api}/api/v3/directory/providers          -> { providers: DirectoryProvider[] }
 *   GET {api}/api/v3/directory/providers/:id      -> DirectoryProvider
 */

export type UptimeLevel = 'healthy' | 'degraded' | 'failing' | 'unknown';

export interface DirectoryRoute {
  method: string;
  pathPattern: string;
  unit: string;
  /** Price per unit, in `asset`. */
  price: number;
  asset: string;
}

export interface DirectoryManifest {
  version: string;
  upstreamBaseUrl: string;
  routes: DirectoryRoute[];
}

export interface DirectoryUptime {
  /** Percentage over the reporting window, or null when there is no data. */
  percent: number | null;
  windowDays: number;
  checkedAt: string | null;
}

export interface DirectoryProvider {
  providerId: string;
  name: string;
  description: string;
  category: string;
  /** Providers must opt in explicitly; the directory never lists anyone else. */
  optedIn: boolean;
  manifest: DirectoryManifest;
  uptime: DirectoryUptime;
}

export interface DirectoryFilters {
  query: string;
  category: string;
  asset: string;
  unit: string;
  /** Raw text from the price inputs; empty string means "no bound". */
  minPrice: string;
  maxPrice: string;
}

export const EMPTY_DIRECTORY_FILTERS: DirectoryFilters = {
  query: '',
  category: '',
  asset: '',
  unit: '',
  minPrice: '',
  maxPrice: '',
};

/** Uptime at or above this is "healthy"; at or above DEGRADED_BELOW is "degraded". */
export const UPTIME_HEALTHY_AT = 99.5;
export const UPTIME_DEGRADED_AT = 95;

export const PLAYGROUND_PATH = '/playground';

export class DirectoryError extends Error {
  readonly status: number | null;
  readonly requestId: string | undefined;

  constructor(message: string, status: number | null = null, requestId?: string) {
    super(message);
    this.name = 'DirectoryError';
    this.status = status;
    this.requestId = requestId;
  }
}

export function directoryApiBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    'http://localhost:3001';
  return raw.replace(/\/+$/, '');
}

/**
 * Acceptance rule: only opted-in providers are listed. The API already
 * filters, but the console enforces it again so a backend regression can
 * never surface a provider that has not consented.
 */
export function onlyOptedIn(providers: readonly DirectoryProvider[]): DirectoryProvider[] {
  return providers.filter((provider) => provider.optedIn === true);
}

function parsePrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** True when the min/max inputs are both set and the range is inverted. */
export function isPriceRangeInvalid(filters: Pick<DirectoryFilters, 'minPrice' | 'maxPrice'>): boolean {
  const min = parsePrice(filters.minPrice);
  const max = parsePrice(filters.maxPrice);
  return min !== null && max !== null && min > max;
}

export function hasActiveDirectoryFilters(filters: DirectoryFilters): boolean {
  return (Object.keys(EMPTY_DIRECTORY_FILTERS) as (keyof DirectoryFilters)[]).some(
    (key) => filters[key].trim() !== '',
  );
}

/**
 * A provider matches the price range when at least one of its routes costs
 * within [min, max]. Filters compose with AND; an invalid (inverted) price
 * range matches nothing rather than silently ignoring the bounds.
 */
export function filterProviders(
  providers: readonly DirectoryProvider[],
  filters: DirectoryFilters,
): DirectoryProvider[] {
  const query = filters.query.trim().toLowerCase();
  const min = parsePrice(filters.minPrice);
  const max = parsePrice(filters.maxPrice);
  if (min !== null && max !== null && min > max) return [];

  return onlyOptedIn(providers).filter((provider) => {
    const routes = provider.manifest.routes;

    if (filters.category && provider.category !== filters.category) return false;
    if (filters.asset && !routes.some((route) => route.asset === filters.asset)) return false;
    if (filters.unit && !routes.some((route) => route.unit === filters.unit)) return false;

    if (min !== null || max !== null) {
      const inRange = routes.some(
        (route) => (min === null || route.price >= min) && (max === null || route.price <= max),
      );
      if (!inRange) return false;
    }

    if (query) {
      const haystack = `${provider.name} ${provider.description} ${provider.category}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export interface FilterOptions {
  categories: string[];
  assets: string[];
  units: string[];
}

/** Distinct, sorted values for the filter dropdowns, from opted-in providers only. */
export function filterOptions(providers: readonly DirectoryProvider[]): FilterOptions {
  const categories = new Set<string>();
  const assets = new Set<string>();
  const units = new Set<string>();
  for (const provider of onlyOptedIn(providers)) {
    categories.add(provider.category);
    for (const route of provider.manifest.routes) {
      assets.add(route.asset);
      units.add(route.unit);
    }
  }
  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
  return { categories: sorted(categories), assets: sorted(assets), units: sorted(units) };
}

export function priceRangeOf(provider: DirectoryProvider): { min: number; max: number; asset: string } | null {
  const routes = provider.manifest.routes;
  if (routes.length === 0) return null;
  const prices = routes.map((route) => route.price);
  return { min: Math.min(...prices), max: Math.max(...prices), asset: routes[0].asset };
}

export function describePriceRange(provider: DirectoryProvider): string {
  const range = priceRangeOf(provider);
  if (!range) return 'No priced routes';
  const fmt = (value: number) => value.toString();
  return range.min === range.max
    ? `${fmt(range.min)} ${range.asset}`
    : `${fmt(range.min)}–${fmt(range.max)} ${range.asset}`;
}

export function uptimeLevel(uptime: DirectoryUptime): UptimeLevel {
  if (uptime.percent === null || !Number.isFinite(uptime.percent)) return 'unknown';
  if (uptime.percent >= UPTIME_HEALTHY_AT) return 'healthy';
  if (uptime.percent >= UPTIME_DEGRADED_AT) return 'degraded';
  return 'failing';
}

const UPTIME_LABELS: Record<UptimeLevel, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  failing: 'Failing',
  unknown: 'No data',
};

/**
 * Status is always carried by text, never by colour alone (#1506): the label
 * is rendered next to the percentage and read by screen readers.
 */
export function describeUptime(uptime: DirectoryUptime): string {
  const level = uptimeLevel(uptime);
  if (level === 'unknown' || uptime.percent === null) return UPTIME_LABELS.unknown;
  return `${UPTIME_LABELS[level]} — ${uptime.percent.toFixed(2)}% over ${uptime.windowDays} days`;
}

export function uptimeLabel(level: UptimeLevel): string {
  return UPTIME_LABELS[level];
}

/** Strip wildcard segments so the snippet shows a callable path. */
function concretePath(pathPattern: string): string {
  const path = pathPattern.replace(/\/?\*+$/, '').replace(/:([A-Za-z0-9_]+)/g, '$1');
  return path.startsWith('/') ? path : `/${path}`;
}

/** Shell-safe single-quoting for values we interpolate into the snippet. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Example call for a route, as a copyable curl snippet. Credentials are
 * environment variables, never values.
 */
export function buildExampleCall(
  route: DirectoryRoute,
  options: { gatewayBase?: string } = {},
): string {
  const base = (options.gatewayBase ?? directoryApiBase()).replace(/\/+$/, '');
  const url = `${base}/api/v3/gateway/proxy${concretePath(route.pathPattern)}`;
  const method = route.method.toUpperCase();
  const lines = [
    `curl -X ${method} ${shellQuote(url)}`,
    `  -H 'Authorization: Bearer '"$SYNCRO_AGENT_TOKEN"`,
    `  -H 'x-syncro-agent-id: '"$SYNCRO_AGENT_ID"`,
  ];
  if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
    lines.push(`  -H 'content-type: application/json'`, `  -d '{}'`);
  }
  return lines.join(' \\\n');
}

/** Deep link into the playground, prefilled with the provider and route. */
export function playgroundHref(provider: Pick<DirectoryProvider, 'providerId'>, route?: DirectoryRoute): string {
  const params = new URLSearchParams({ provider: provider.providerId });
  if (route) {
    params.set('method', route.method.toUpperCase());
    params.set('path', route.pathPattern);
  }
  return `${PLAYGROUND_PATH}?${params.toString()}`;
}

/** The directory is browsable without signing in (checked by the auth middleware). */
export function isPublicDirectoryRoute(pathname: string): boolean {
  return pathname === '/directory' || pathname.startsWith('/directory/');
}

export function providerHref(providerId: string): string {
  return `/directory/${encodeURIComponent(providerId)}`;
}

async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new DirectoryError('Could not reach the directory.');
  }
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (response.status === 404) throw new DirectoryError('Provider not found.', 404, requestId);
  if (!response.ok) {
    throw new DirectoryError('The directory is unavailable right now.', response.status, requestId);
  }
  return (await response.json()) as T;
}

export interface DirectoryClient {
  list(signal?: AbortSignal): Promise<DirectoryProvider[]>;
  get(providerId: string, signal?: AbortSignal): Promise<DirectoryProvider>;
}

export function createDirectoryClient(apiBase: string = directoryApiBase()): DirectoryClient {
  const base = apiBase.replace(/\/+$/, '');
  return {
    async list(signal) {
      const body = await request<{ providers: DirectoryProvider[] }>(
        `${base}/api/v3/directory/providers`,
        signal,
      );
      return onlyOptedIn(Array.isArray(body.providers) ? body.providers : []);
    },
    async get(providerId, signal) {
      const provider = await request<DirectoryProvider>(
        `${base}/api/v3/directory/providers/${encodeURIComponent(providerId)}`,
        signal,
      );
      // A provider that has not opted in must look exactly like one that does not exist.
      if (provider.optedIn !== true) throw new DirectoryError('Provider not found.', 404);
      return provider;
    },
  };
}
