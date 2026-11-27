import { describe, expect, it } from 'vitest';
import { buildMonthlySettlementCsv, SETTLEMENT_CSV_HEADERS } from '../src/v3/settlement-csv';
import type { ProviderSettlement } from '../src/v3/types';

function settlement(overrides: Partial<ProviderSettlement>): ProviderSettlement {
  return {
    settlementId: 'settlement-1',
    providerId: 'provider-1',
    routeId: 'route-1',
    receiptId: 'receipt-1',
    method: 'GET',
    pathPattern: '/weather',
    unit: 'call',
    quantity: 10,
    priceStroops: 100,
    amount: 1000,
    rateCardVersion: 'version-1',
    rateCardEffectiveFrom: '2026-04-01T00:00:00.000Z',
    status: 'settled',
    meteredAt: '2026-04-15T12:00:00.000Z',
    channelId: 'channel-1',
    ...overrides,
  };
}

describe('monthly settlement CSV export', () => {
  it('exports the requested columns and reconciles only settled April totals', () => {
    const rows = [
      settlement({ settlementId: '1', amount: 1000, quantity: 10 }),
      settlement({ settlementId: '2', amount: 500, quantity: 5, meteredAt: '2026-04-20T12:00:00.000Z' }),
      settlement({ settlementId: '3', amount: 9000, status: 'unsettled', meteredAt: '2026-04-22T12:00:00.000Z' }),
      settlement({ settlementId: '4', amount: 7000, meteredAt: '2026-05-01T12:00:00.000Z' }),
    ];

    const result = buildMonthlySettlementCsv(rows, {
      period: '2026-04',
      feeStroops: () => 25,
      txHash: (row) => `hash-${row.settlementId}`,
    });

    expect(result.csv.split('\n')[0].split(',')).toEqual([...SETTLEMENT_CSV_HEADERS]);
    expect(result.csv).toContain('2026-04-15,provider-1,route-1,10,call,1000,25,975,XLM,hash-1');
    expect(result.totals).toEqual({ gross: 1500, fee: 50, net: 1450 });
  });

  it('rejects periods that are not YYYY-MM', () => {
    expect(() => buildMonthlySettlementCsv([], { period: 'April 2026' })).toThrow(/YYYY-MM/);
  });
});
