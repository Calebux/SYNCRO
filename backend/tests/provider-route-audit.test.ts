/**
 * Audit events for provider route and price changes (issue #1700).
 *
 * Route create, update, and delete must each land in the hash-chained audit
 * log with the old and new price and extractor, so a billing dispute can be
 * resolved by walking the chain.
 */

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));
jest.mock('../src/config/database', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../src/middleware/requestContext', () => ({
  getRequestId: jest.fn(() => 'test-correlation-id'),
}));

import { supabase } from '../src/config/database';
import { auditService } from '../src/services/audit-service';
import { verifyChainRows, type AuditLogRow } from '../src/services/audit-chain';
import {
  auditProviderRouteEvent,
  type ProviderRouteAuditAction,
} from '../src/services/provider-route-audit';
import {
  InMemoryProviderStore,
  type ProviderRouteChangeEvent,
} from '../src/v3/provider-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFrom = supabase.from as any;

/** Minimal in-memory `audit_logs` stand-in (tip read + inserts). */
class FakeAuditTable {
  rows: AuditLogRow[] = [];

  install(): void {
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'audit_logs') throw new Error(`unexpected table: ${table}`);
      return this.builder();
    });
  }

  private builder() {
    const filters: { descending?: boolean; limit?: number } = {};
    let pending: AuditLogRow[] | null = null;

    const resolve = (): { data: AuditLogRow[]; error: null } => {
      if (pending) {
        for (const row of pending) {
          if (this.rows.some((existing) => existing.sequence === row.sequence)) {
            return { data: [], error: { code: '23505', message: 'duplicate key' } } as never;
          }
        }
        this.rows.push(...pending);
        return { data: pending, error: null };
      }
      let out = [...this.rows].filter((r) => r.sequence != null);
      out.sort((a, b) =>
        filters.descending
          ? Number(b.sequence) - Number(a.sequence)
          : Number(a.sequence) - Number(b.sequence),
      );
      if (filters.limit !== undefined) out = out.slice(0, filters.limit);
      return { data: out, error: null };
    };

    const builder: any = {
      select: jest.fn(() => builder),
      not: jest.fn(() => builder),
      order: jest.fn((_col: string, opts?: { ascending?: boolean }) => {
        filters.descending = opts?.ascending === false;
        return builder;
      }),
      limit: jest.fn((n: number) => { filters.limit = n; return builder; }),
      insert: jest.fn((rows: AuditLogRow[]) => {
        pending = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r, id: `id-${r.sequence}` }));
        return builder;
      }),
      then: (onFulfilled: (value: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled),
    };

    return builder;
  }
}

const KIND_TO_ACTION: Record<ProviderRouteChangeEvent['kind'], ProviderRouteAuditAction> = {
  created: 'provider.route_created',
  updated: 'provider.route_updated',
  deleted: 'provider.route_deleted',
};

describe('Provider route audit events (issue #1700)', () => {
  let table: FakeAuditTable;

  beforeEach(() => {
    jest.clearAllMocks();
    table = new FakeAuditTable();
    table.install();
  });

  it('writes create, update, and delete events with old/new price and extractor', async () => {
    const seen: ProviderRouteChangeEvent[] = [];
    const store = new InMemoryProviderStore((event) => {
      seen.push(event);
    });

    const provider = store.registerProvider({
      identity: 'provider-1',
      payoutAddress: 'GABC',
      upstreamBaseUrl: 'https://example.com',
      agreementTerms: 'terms',
      mode: 'production',
    });

    const route = store.registerRoute({
      providerId: provider.providerId,
      pathPattern: '/api/generate',
      method: 'POST',
      unit: 'call',
      price: 0.01,
      quantityExtractor: '$.usage.calls',
    });

    const { version } = store.reviseRoute(provider.providerId, route.routeId, {
      price: 0.05,
      quantityExtractor: '$.usage.tokens',
    });
    expect(version.price).toBe(0.05);

    store.deleteRoute(provider.providerId, route.routeId);

    expect(seen.map((e) => e.kind)).toEqual(['created', 'updated', 'deleted']);

    for (const event of seen) {
      await auditProviderRouteEvent(KIND_TO_ACTION[event.kind], {
        actorId: 'operator-1',
        oldRoute: event.oldRoute ?? undefined,
        newRoute: event.newRoute ?? undefined,
        rateCardVersion: event.rateCardVersion,
      });
    }

    expect(table.rows.map((r) => r.action)).toEqual([
      'provider.route_created',
      'provider.route_updated',
      'provider.route_deleted',
    ]);

    // Every event is chained to the previous one.
    expect(table.rows[1].prev_hash).toBe(table.rows[0].entry_hash);
    expect(table.rows[2].prev_hash).toBe(table.rows[1].entry_hash);
    expect(verifyChainRows(table.rows)).toMatchObject({ valid: true });
  });

  it('records the price change content for a price update', async () => {
    const seen: ProviderRouteChangeEvent[] = [];
    const store = new InMemoryProviderStore((event) => {
      seen.push(event);
    });

    const provider = store.registerProvider({
      identity: 'provider-1',
      payoutAddress: 'GABC',
      upstreamBaseUrl: 'https://example.com',
      agreementTerms: 'terms',
      mode: 'production',
    });

    const route = store.registerRoute({
      providerId: provider.providerId,
      pathPattern: '/api/generate',
      method: 'POST',
      unit: 'call',
      price: 0.01,
      quantityExtractor: '$.usage.calls',
    });

    const { version } = store.reviseRoute(provider.providerId, route.routeId, {
      price: 0.05,
      quantityExtractor: '$.usage.tokens',
    });

    const update = seen.find((e) => e.kind === 'updated');
    expect(update).toBeDefined();

    await auditProviderRouteEvent('provider.route_updated', {
      actorId: 'operator-1',
      oldRoute: update!.oldRoute ?? undefined,
      newRoute: update!.newRoute ?? undefined,
      rateCardVersion: update!.rateCardVersion,
    });

    expect(table.rows).toHaveLength(1);
    const row = table.rows[0];
    expect(row.resource_type).toBe('provider_route');
    expect(row.resource_id).toBe(route.routeId);
    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.oldPrice).toBe(0.01);
    expect(metadata.newPrice).toBe(0.05);
    expect(metadata.oldQuantityExtractor).toBe('$.usage.calls');
    expect(metadata.newQuantityExtractor).toBe('$.usage.tokens');
    expect(metadata.rateCardVersion).toBe(version.versionId);
    expect(verifyChainRows(table.rows)).toMatchObject({ valid: true });
  });
});
