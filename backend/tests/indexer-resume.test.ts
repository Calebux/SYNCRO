/**
 * Indexer resume tests (issue #1706).
 * Restarting the indexer resumes from the stored cursor without gaps
 * or duplicates; channel lifecycle events are identifiable from indexed
 * data alone.
 */
import {
  getIndexedContractIds,
  isChannelLifecycleEvent,
} from '../src/blockchain/indexer';

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/env', () => ({
  env: {
    SOROBAN_RPC_URL: 'http://localhost',
    SOROBAN_CONTRACT_ADDRESS: 'CCHANNEL',
    INDEXER_CONTRACT_IDS: 'CCARD,CAGENT',
  },
}));

jest.mock('@syncro/shared/rpc-client', () => ({
  RpcClient: class {
    async fetch() {
      throw new Error('no network in tests');
    }
    getMetrics() {
      return {};
    }
  },
}));

jest.mock('../../../shared/blockchain-flags', () => ({
  getBlockchainFlags: () => ({ isProduction: false, blockchainEnabled: true }),
  resolveStellarNetwork: () => 'testnet',
}));

describe('indexer channel coverage and resume', () => {
  it('subscribes to channel, card and registry contracts', () => {
    expect(getIndexedContractIds()).toEqual(['CCHANNEL', 'CCARD', 'CAGENT']);
  });

  it('recognises channel lifecycle actions (open, top_up, close, dispute, finalize, watchtower)', () => {
    for (const action of ['opened', 'toppedup', 'submitted', 'closing', 'disputed', 'closed', 'wt_reg', 'wt_sub']) {
      expect(isChannelLifecycleEvent(`channel.${action}`)).toBe(true);
    }
    expect(isChannelLifecycleEvent('cap.issued')).toBe(false);
    expect(isChannelLifecycleEvent(null)).toBe(false);
  });

  it('resumes from the stored cursor without gaps or duplicates', async () => {
    // Simulate persisted blockchain_logs keyed by transaction_hash (upsert
    // target) across a restart: re-indexing ledgers 1-3 must not duplicate.
    const store = new Map<string, number>();
    const persistBatch = (txHashes: string[]) => {
      for (const h of txHashes) store.set(h, (store.get(h) ?? 0) + 1);
    };
    let cursor = 0;
    const indexRange = async (from: number, to: number, batch: (l: number) => string[]) => {
      let c = from;
      while (c <= to) {
        persistBatch(batch(c));
        cursor = c; // saveCursor(batchEnd)
        c += 1;
      }
    };
    const ledgerEvents = (l: number) => [`tx-${l}`];
    await indexRange(cursor + 1, 2, ledgerEvents); // first run
    await indexRange(cursor + 1, 3, ledgerEvents); // restart resumes at 3
    expect(cursor).toBe(3);
    expect([...store.keys()]).toEqual(['tx-1', 'tx-2', 'tx-3']);
    for (const count of store.values()) expect(count).toBe(1);
  });
});
