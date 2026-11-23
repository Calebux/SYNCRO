import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_DIRECTORY_FILTERS,
  buildExampleCall,
  createDirectoryClient,
  describePriceRange,
  describeUptime,
  filterOptions,
  filterProviders,
  hasActiveDirectoryFilters,
  isPriceRangeInvalid,
  isPublicDirectoryRoute,
  onlyOptedIn,
  playgroundHref,
  providerHref,
  uptimeLevel,
  type DirectoryFilters,
  type DirectoryProvider,
} from '@/lib/provider-directory';

function provider(overrides: Partial<DirectoryProvider> & { providerId: string }): DirectoryProvider {
  return {
    name: overrides.providerId,
    description: 'A paid API',
    category: 'inference',
    optedIn: true,
    manifest: {
      version: '1',
      upstreamBaseUrl: 'https://provider.example',
      routes: [{ method: 'POST', pathPattern: '/echo/*', unit: 'request', price: 1, asset: 'USDC' }],
    },
    uptime: { percent: 99.99, windowDays: 30, checkedAt: '2026-11-01T00:00:00.000Z' },
    ...overrides,
  };
}

const filters = (overrides: Partial<DirectoryFilters>): DirectoryFilters => ({
  ...EMPTY_DIRECTORY_FILTERS,
  ...overrides,
});

const acme = provider({
  providerId: 'acme',
  name: 'Acme Inference',
  description: 'Fast text models',
  category: 'inference',
  manifest: {
    version: '2',
    upstreamBaseUrl: 'https://acme.example',
    routes: [
      { method: 'POST', pathPattern: '/chat/*', unit: 'token', price: 0.002, asset: 'USDC' },
      { method: 'POST', pathPattern: '/embed/*', unit: 'token', price: 0.0005, asset: 'USDC' },
    ],
  },
});
const bucket = provider({
  providerId: 'bucket',
  name: 'Bucket Storage',
  description: 'Object storage by the byte',
  category: 'storage',
  manifest: {
    version: '1',
    upstreamBaseUrl: 'https://bucket.example',
    routes: [{ method: 'PUT', pathPattern: '/objects/*', unit: 'byte', price: 5, asset: 'XLM' }],
  },
});
const crunch = provider({
  providerId: 'crunch',
  name: 'Crunch Compute',
  description: 'GPU seconds',
  category: 'compute',
  manifest: {
    version: '1',
    upstreamBaseUrl: 'https://crunch.example',
    routes: [{ method: 'POST', pathPattern: '/run', unit: 'second', price: 12, asset: 'USDC' }],
  },
});
const all = [acme, bucket, crunch];
const ids = (list: DirectoryProvider[]) => list.map((p) => p.providerId);

describe('opt-in rule', () => {
  const hidden = provider({ providerId: 'hidden', optedIn: false });

  it('drops providers that have not opted in', () => {
    expect(ids(onlyOptedIn([acme, hidden]))).toEqual(['acme']);
  });

  it('never returns a non-opted-in provider from filtering, whatever the filters', () => {
    expect(ids(filterProviders([acme, hidden], EMPTY_DIRECTORY_FILTERS))).toEqual(['acme']);
    expect(ids(filterProviders([acme, hidden], filters({ query: 'hidden' })))).toEqual([]);
  });

  it('treats a missing or non-boolean optedIn as not opted in', () => {
    const malformed = { ...acme, providerId: 'malformed', optedIn: undefined } as unknown as DirectoryProvider;
    const stringy = { ...acme, providerId: 'stringy', optedIn: 'true' } as unknown as DirectoryProvider;
    expect(onlyOptedIn([malformed, stringy])).toEqual([]);
  });

  it('keeps non-opted-in providers out of the filter dropdown options', () => {
    const secret = provider({ providerId: 'secret', optedIn: false, category: 'secret-category' });
    expect(filterOptions([acme, secret]).categories).toEqual(['inference']);
  });
});

describe('filterProviders', () => {
  it('returns every opted-in provider with no filters', () => {
    expect(ids(filterProviders(all, EMPTY_DIRECTORY_FILTERS))).toEqual(['acme', 'bucket', 'crunch']);
  });

  it('filters by category', () => {
    expect(ids(filterProviders(all, filters({ category: 'storage' })))).toEqual(['bucket']);
  });

  it('filters by asset', () => {
    expect(ids(filterProviders(all, filters({ asset: 'XLM' })))).toEqual(['bucket']);
    expect(ids(filterProviders(all, filters({ asset: 'USDC' })))).toEqual(['acme', 'crunch']);
  });

  it('filters by unit', () => {
    expect(ids(filterProviders(all, filters({ unit: 'token' })))).toEqual(['acme']);
    expect(ids(filterProviders(all, filters({ unit: 'second' })))).toEqual(['crunch']);
  });

  it('filters by price range using any route within the range', () => {
    expect(ids(filterProviders(all, filters({ minPrice: '1' })))).toEqual(['bucket', 'crunch']);
    expect(ids(filterProviders(all, filters({ maxPrice: '1' })))).toEqual(['acme']);
    expect(ids(filterProviders(all, filters({ minPrice: '0.001', maxPrice: '0.01' })))).toEqual(['acme']);
  });

  it('treats the price bounds as inclusive', () => {
    expect(ids(filterProviders(all, filters({ minPrice: '12', maxPrice: '12' })))).toEqual(['crunch']);
  });

  it('matches a provider on one route only when that same route satisfies the range', () => {
    // acme has 0.002 and 0.0005; a range between them matches neither route.
    expect(ids(filterProviders([acme], filters({ minPrice: '0.001', maxPrice: '0.0015' })))).toEqual([]);
  });

  it('searches name, description and category case-insensitively', () => {
    expect(ids(filterProviders(all, filters({ query: 'ACME' })))).toEqual(['acme']);
    expect(ids(filterProviders(all, filters({ query: 'gpu' })))).toEqual(['crunch']);
    expect(ids(filterProviders(all, filters({ query: 'storage' })))).toEqual(['bucket']);
  });

  it('combines filters with AND', () => {
    expect(ids(filterProviders(all, filters({ asset: 'USDC', category: 'compute' })))).toEqual(['crunch']);
    expect(ids(filterProviders(all, filters({ asset: 'XLM', category: 'compute' })))).toEqual([]);
  });

  it('matches nothing, rather than ignoring the bounds, when the price range is inverted', () => {
    const inverted = filters({ minPrice: '10', maxPrice: '1' });
    expect(isPriceRangeInvalid(inverted)).toBe(true);
    expect(filterProviders(all, inverted)).toEqual([]);
  });

  it('ignores unparseable or negative price input', () => {
    expect(ids(filterProviders(all, filters({ minPrice: 'abc' })))).toEqual(['acme', 'bucket', 'crunch']);
    expect(ids(filterProviders(all, filters({ minPrice: '-5' })))).toEqual(['acme', 'bucket', 'crunch']);
  });

  it('does not mutate its input', () => {
    const input = [...all];
    filterProviders(input, filters({ category: 'storage' }));
    expect(input).toEqual(all);
  });
});

describe('filter helpers', () => {
  it('detects when any filter is active', () => {
    expect(hasActiveDirectoryFilters(EMPTY_DIRECTORY_FILTERS)).toBe(false);
    expect(hasActiveDirectoryFilters(filters({ unit: 'byte' }))).toBe(true);
    expect(hasActiveDirectoryFilters(filters({ query: '   ' }))).toBe(false);
  });

  it('lists distinct sorted options', () => {
    expect(filterOptions(all)).toEqual({
      categories: ['compute', 'inference', 'storage'],
      assets: ['USDC', 'XLM'],
      units: ['byte', 'second', 'token'],
    });
  });
});

describe('describePriceRange', () => {
  it('shows a single price or a range', () => {
    expect(describePriceRange(bucket)).toBe('5 XLM');
    expect(describePriceRange(acme)).toBe('0.0005–0.002 USDC');
  });

  it('handles a provider with no priced routes', () => {
    const empty = provider({
      providerId: 'empty',
      manifest: { version: '1', upstreamBaseUrl: 'https://x.example', routes: [] },
    });
    expect(describePriceRange(empty)).toBe('No priced routes');
  });
});

describe('uptime', () => {
  const up = (percent: number | null) => ({ percent, windowDays: 30, checkedAt: null });

  it('classifies healthy, degraded, failing and unknown', () => {
    expect(uptimeLevel(up(100))).toBe('healthy');
    expect(uptimeLevel(up(99.5))).toBe('healthy');
    expect(uptimeLevel(up(99.49))).toBe('degraded');
    expect(uptimeLevel(up(95))).toBe('degraded');
    expect(uptimeLevel(up(94.99))).toBe('failing');
    expect(uptimeLevel(up(null))).toBe('unknown');
    expect(uptimeLevel(up(Number.NaN))).toBe('unknown');
  });

  it('always states the status in words, never colour alone', () => {
    expect(describeUptime(up(99.9))).toBe('Healthy — 99.90% over 30 days');
    expect(describeUptime(up(97))).toBe('Degraded — 97.00% over 30 days');
    expect(describeUptime(up(50))).toBe('Failing — 50.00% over 30 days');
    expect(describeUptime(up(null))).toBe('No data');
  });
});

describe('buildExampleCall', () => {
  const route = { method: 'POST', pathPattern: '/chat/*', unit: 'token', price: 1, asset: 'USDC' };

  it('builds a curl call through the gateway with credentials from env vars', () => {
    const call = buildExampleCall(route, { gatewayBase: 'https://api.syncro.example/' });
    expect(call).toContain("curl -X POST 'https://api.syncro.example/api/v3/gateway/proxy/chat'");
    expect(call).toContain('$SYNCRO_AGENT_TOKEN');
    expect(call).toContain('$SYNCRO_AGENT_ID');
    expect(call).toContain("-d '{}'");
  });

  it('omits the body for GET calls', () => {
    const call = buildExampleCall({ ...route, method: 'get', pathPattern: '/status' }, { gatewayBase: 'https://a.example' });
    expect(call).toContain("curl -X GET 'https://a.example/api/v3/gateway/proxy/status'");
    expect(call).not.toContain('-d ');
    expect(call).not.toContain('content-type');
  });

  it('never embeds a credential value', () => {
    expect(buildExampleCall(route, { gatewayBase: 'https://a.example' })).not.toMatch(/Bearer [A-Za-z0-9]/);
  });

  it('shell-quotes the URL so a hostile path cannot break out of the snippet', () => {
    const call = buildExampleCall({ ...route, pathPattern: "/x'; rm -rf ~; echo '" }, { gatewayBase: 'https://a.example' });
    const urlLine = call.split(' \\\n')[0];
    expect(urlLine).toBe(`curl -X POST 'https://a.example/api/v3/gateway/proxy/x'\\''; rm -rf ~; echo '\\'''`);
  });
});

describe('links', () => {
  it('builds a playground link prefilled with provider and route', () => {
    const href = playgroundHref(acme, acme.manifest.routes[0]);
    const url = new URL(href, 'https://syncro.example');
    expect(url.pathname).toBe('/playground');
    expect(url.searchParams.get('provider')).toBe('acme');
    expect(url.searchParams.get('method')).toBe('POST');
    expect(url.searchParams.get('path')).toBe('/chat/*');
  });

  it('links to a provider with the id encoded', () => {
    expect(providerHref('a/b c')).toBe('/directory/a%2Fb%20c');
  });
});

describe('createDirectoryClient', () => {
  const okJson = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

  it('lists providers and strips any that are not opted in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({ providers: [acme, provider({ providerId: 'hidden', optedIn: false })] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const list = await createDirectoryClient('https://api.example/').list();

    expect(ids(list)).toEqual(['acme']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example/api/v3/directory/providers');
    vi.unstubAllGlobals();
  });

  it('treats a provider that has not opted in as not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ...acme, optedIn: false })));
    await expect(createDirectoryClient('https://api.example').get('acme')).rejects.toMatchObject({ status: 404 });
    vi.unstubAllGlobals();
  });

  it('maps a 404 to not found and carries the request id on other failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })));
    await expect(createDirectoryClient('https://api.example').get('nope')).rejects.toMatchObject({ status: 404 });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response('', { status: 503, headers: { 'x-request-id': 'req-9' } })),
    );
    await expect(createDirectoryClient('https://api.example').list()).rejects.toMatchObject({
      status: 503,
      requestId: 'req-9',
    });
    vi.unstubAllGlobals();
  });

  it('reports a network failure without leaking the underlying error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connect ECONNREFUSED 10.0.0.5:3001')));
    await expect(createDirectoryClient('https://api.example').list()).rejects.toThrow('Could not reach the directory.');
    vi.unstubAllGlobals();
  });

  it('tolerates a malformed list body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ providers: 'nope' })));
    await expect(createDirectoryClient('https://api.example').list()).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('public route allowlist', () => {
  it('treats the directory and its detail pages as public, and nothing else', () => {
    expect(isPublicDirectoryRoute('/directory')).toBe(true);
    expect(isPublicDirectoryRoute('/directory/acme')).toBe(true);
    expect(isPublicDirectoryRoute('/directory-admin')).toBe(false);
    expect(isPublicDirectoryRoute('/directoryx/acme')).toBe(false);
    expect(isPublicDirectoryRoute('/dashboard')).toBe(false);
    expect(isPublicDirectoryRoute('/settings')).toBe(false);
  });
});
