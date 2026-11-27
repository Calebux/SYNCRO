/**
 * Indexer event schema-version tests (issue #1705).
 * Verifies all v3 contract events carry a version and the indexer
 * branches on v1 payloads.
 */
import { decodeEventByVersion, EVENT_SCHEMA_VERSION } from '../src/blockchain/indexer';

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/env', () => ({
  env: { SOROBAN_RPC_URL: 'http://localhost', SOROBAN_CONTRACT_ADDRESS: 'C' },
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

describe('indexer event schema version', () => {
  it('pins the current version to 1', () => {
    expect(EVENT_SCHEMA_VERSION).toBe(1);
  });

  it('decodes version 1 payloads for channel, card and registry events', () => {
    const payloads = [
      { schema_version: 1, channel_id: 7 },
      { schema_version: 1, cap_id: 'cap-1' },
      { schema_version: 1, agent: 'GAGENT' },
    ];
    for (const p of payloads) {
      expect(decodeEventByVersion(p, 1)).toBe(p);
      expect(decodeEventByVersion(p)).toBe(p);
    }
  });

  it('passes through unknown future versions instead of dropping them', () => {
    const future = { schema_version: 2, channel_id: 7 };
    expect(decodeEventByVersion(future, 2)).toBe(future);
  });
});
