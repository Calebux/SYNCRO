import { InMemoryProviderStore } from '../src/v3/provider-store';

function register(store: InMemoryProviderStore, providerId: string, pathPattern: string, method = 'POST') {
  return store.registerRoute({
    providerId,
    pathPattern,
    method,
    unit: 'calls',
    price: 1,
    quantityExtractor: 'constant:1',
  });
}

describe('v3 provider route matching (issue #1698)', () => {
  it('prefers the exact pattern over a wildcard regardless of registration order', () => {
    const store = new InMemoryProviderStore();
    register(store, 'p1', '/v1/*');
    register(store, 'p1', '/v1/chat');

    expect(store.findRoute('p1', 'POST', '/v1/chat')?.pathPattern).toBe('/v1/chat');
    expect(store.findRoute('p1', 'POST', '/v1/other')?.pathPattern).toBe('/v1/*');
  });

  it('prefers fewer wildcards, then longer literals, independent of method case', () => {
    const store = new InMemoryProviderStore();
    register(store, 'p1', '/v1/*/summary');
    register(store, 'p1', '/v1/chat/*');

    const match = store.findRoute('p1', 'post', '/v1/chat/summary');
    // Both have one wildcard; '/v1/chat/*' has more literal characters.
    expect(match?.pathPattern).toBe('/v1/chat/*');
    expect(store.findRoute('p1', 'POST', '/v1/billing/summary')?.pathPattern).toBe('/v1/*/summary');
  });

  it('rejects exact duplicate registration with 409-mapped message', () => {
    const store = new InMemoryProviderStore();
    register(store, 'p1', '/v1/chat');
    expect(() => register(store, 'p1', '/v1/chat')).toThrow('route already registered for provider');
    // Same pattern under a different method is a different route.
    expect(() => register(store, 'p1', '/v1/chat', 'GET')).not.toThrow();
  });

  it('rejects revising a route into a duplicate of another route', () => {
    const store = new InMemoryProviderStore();
    register(store, 'p1', '/v1/chat');
    const other = register(store, 'p1', '/v1/other');
    expect(() =>
      store.reviseRoute('p1', other.routeId, { pathPattern: '/v1/chat' }),
    ).toThrow('route already registered for provider');
  });

  it('dry-run shows the winning route and price without serving', () => {
    const store = new InMemoryProviderStore();
    register(store, 'p1', '/v1/*');
    register(store, 'p1', '/v1/chat');

    const hit = store.dryRunRoute('p1', 'POST', '/v1/chat');
    expect(hit?.route.pathPattern).toBe('/v1/chat');
    expect(hit?.route.price).toBe(1);
    expect(hit?.applicableVersion).not.toBeNull();

    expect(store.dryRunRoute('p1', 'POST', '/nope')).toBeNull();
  });
});
