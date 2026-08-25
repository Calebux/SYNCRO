/**
 * Settlement batcher unit + load-style tests.
 * Verifies bounded batching, backpressure, and metrics under load.
 */

import {
  SettlementBatcher,
  SettlementBackpressureError,
} from '../src/services/settlement-batcher';

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockFrom = jest.fn();
jest.mock('../src/config/database', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

jest.mock('../src/services/blockchain-service', () => ({
  blockchainService: {
    syncSubscription: jest.fn().mockResolvedValue({ transactionHash: 'tx_test' }),
  },
}));

function chainable(result: Record<string, unknown>) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  for (const m of ['select', 'insert', 'update', 'eq', 'lte', 'order', 'limit', 'in', 'single']) {
    api[m] = jest.fn().mockImplementation(() => {
      if (m === 'single' || m === 'select') {
        // select with head returns count; single returns data
        return Promise.resolve(result);
      }
      return api;
    });
  }
  // Make thenable for await on builder
  (api as { then?: unknown }).then = undefined;
  api.select = jest.fn().mockImplementation((_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.head) {
      return {
        eq: jest.fn().mockResolvedValue(result),
      };
    }
    const q: Record<string, unknown> = {};
    q.eq = jest.fn().mockReturnValue(q);
    q.lte = jest.fn().mockReturnValue(q);
    q.order = jest.fn().mockReturnValue(q);
    q.limit = jest.fn().mockResolvedValue(result);
    q.in = jest.fn().mockResolvedValue(result);
    return q;
  });
  api.insert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue(result),
    }),
  });
  api.update = jest.fn().mockReturnValue({
    in: jest.fn().mockResolvedValue({ error: null }),
  });
  return api;
}

describe('SettlementBatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes configurable bounded batch sizes', () => {
    const batcher = new SettlementBatcher({
      minBatchSize: 2,
      maxBatchSize: 5,
      maxQueueDepth: 10,
      maxInFlightBatches: 1,
    });
    const cfg = batcher.getConfig();
    expect(cfg.maxBatchSize).toBe(5);
    expect(cfg.maxQueueDepth).toBe(10);
    expect(cfg.minBatchSize).toBeLessThanOrEqual(cfg.maxBatchSize);
  });

  it('rejects enqueue when queue depth is at capacity (backpressure)', async () => {
    mockFrom.mockReturnValue(
      chainable({ count: 10, error: null, data: null }),
    );
    // getQueueDepth uses select head; enqueue checks depth first
    const batcher = new SettlementBatcher({ maxQueueDepth: 10, maxBatchSize: 5 });

    await expect(
      batcher.enqueue({
        userId: 'u1',
        subscriptionId: 's1',
        amount: 1,
        settlementType: 'renewal',
        payload: {},
      }),
    ).rejects.toBeInstanceOf(SettlementBackpressureError);

    expect(batcher.getMetrics().backpressureRejections).toBe(1);
  });

  it('never returns a batch larger than maxBatchSize', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `id-${i}`,
      user_id: 'u1',
      subscription_id: `sub-${i}`,
      amount: 10,
      settlement_type: 'renewal',
      payload: {},
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }));

    mockFrom.mockReturnValue(
      chainable({ data: rows, error: null, count: rows.length }),
    );

    const batcher = new SettlementBatcher({
      minBatchSize: 1,
      maxBatchSize: 8,
      maxWaitMs: 1000,
      maxQueueDepth: 1000,
    });

    const batch = await batcher.getPendingBatch();
    expect(batch.length).toBeLessThanOrEqual(8);
    expect(batch.length).toBe(8);
  });

  it('skips processPending when in-flight cap is reached', async () => {
    const batcher = new SettlementBatcher({
      maxInFlightBatches: 1,
      minBatchSize: 1,
      maxBatchSize: 5,
    });

    // Force in-flight by calling processPending while one is hanging
    let resolvePending: () => void;
    const hang = new Promise<void>((r) => {
      resolvePending = r;
    });

    const rows = [
      {
        id: 'id-1',
        user_id: 'u1',
        subscription_id: 's1',
        amount: 1,
        settlement_type: 'renewal',
        payload: {},
        created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    ];

    mockFrom.mockReturnValue(
      chainable({ data: rows, error: null, count: 1 }),
    );

    const { blockchainService } = require('../src/services/blockchain-service');
    blockchainService.syncSubscription.mockImplementation(async () => {
      await hang;
      return { transactionHash: 'tx' };
    });

    const first = batcher.processPending();
    // Give first call time to increment inFlight
    await new Promise((r) => setImmediate(r));
    const second = await batcher.processPending();
    expect(second.skipped).toBe('in_flight_cap');
    expect(second.processed).toBe(0);

    resolvePending!();
    await first;
  });

  it('load: many submitBatch calls stay within maxBatchSize and update metrics', async () => {
    const maxBatchSize = 10;
    const batcher = new SettlementBatcher({
      minBatchSize: 1,
      maxBatchSize,
      maxQueueDepth: 10_000,
      maxWaitMs: 0,
    });

    mockFrom.mockReturnValue(
      chainable({ data: null, error: null }),
    );

    const makeBatch = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `load-${i}`,
        userId: 'u',
        subscriptionId: `s-${i}`,
        amount: 1,
        settlementType: 'renewal' as const,
        payload: {},
        createdAt: new Date().toISOString(),
      }));

    // Oversize input must be capped
    const oversized = makeBatch(250);
    const { batchId } = await batcher.submitBatch(oversized);
    expect(batchId).toContain('_10'); // batchId embeds capped length
    expect(batcher.getMetrics().lastBatchSize).toBe(maxBatchSize);
    expect(batcher.getMetrics().processed).toBe(maxBatchSize);
    expect(batcher.getMetrics().batchesSubmitted).toBe(1);

    // Simulate many sequential flushes under load
    for (let i = 0; i < 20; i++) {
      await batcher.submitBatch(makeBatch(maxBatchSize));
    }
    const m = batcher.getMetrics();
    expect(m.batchesSubmitted).toBe(21);
    expect(m.processed).toBe(21 * maxBatchSize);
    expect(m.lastBatchSize).toBeLessThanOrEqual(maxBatchSize);
  });
});
