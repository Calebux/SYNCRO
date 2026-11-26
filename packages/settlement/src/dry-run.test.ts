import { describe, expect, it } from 'vitest';
import { simulateSettlementBatch, type SettlementDryRunItem } from './dry-run';

const item: SettlementDryRunItem = {
  channelId: 'channel-1', amount: 40n, nonce: 8,
  expectedNonce: 8, capacity: 100n, settled: 50n,
  feeBase: 3n, feePerOperation: 2n, operationCount: 4,
};

describe('simulateSettlementBatch', () => {
  it('reports the same proposed channel state and estimated fee without submission', () => {
    expect(simulateSettlementBatch([item])).toEqual({
      items: [{
        channelId: 'channel-1', amount: '40', nonce: 8, estimatedFee: '11',
        outcome: 'would_submit', failures: [],
      }],
      totals: { amount: '40', estimatedFee: '11', ready: 1, failed: 0 },
    });
  });

  it('reports all validation failures while retaining each candidate in the report', () => {
    const result = simulateSettlementBatch([{ ...item, nonce: 7, amount: 60n }]);
    expect(result.items[0]).toMatchObject({
      outcome: 'would_fail',
      failures: ['nonce_mismatch', 'capacity_exceeded'],
    });
    expect(result.totals).toEqual({ amount: '60', estimatedFee: '11', ready: 0, failed: 1 });
  });

  it('rejects malformed fee inputs rather than reporting a misleading estimate', () => {
    expect(() => simulateSettlementBatch([{ ...item, operationCount: -1 }]))
      .toThrow('operationCount must be a non-negative integer');
  });
});
