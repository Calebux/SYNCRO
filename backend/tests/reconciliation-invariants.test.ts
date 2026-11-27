/**
 * backend/tests/reconciliation-invariants.test.ts
 *
 * Place at: backend/tests/reconciliation-invariants.test.ts (new file)
 *
 * Satisfies the acceptance criterion: "A deliberately injected discrepancy
 * is detected within one job interval in a test."
 *
 * ADJUST: this repo's test runner (check package.json — likely Jest given
 * the existing `npm test -w backend` scripts referenced in PR #776).
 * Mocks `supabase`, `getConfirmedOnChainRenewals`, `getSafeBlockHeight`,
 * `isBlockCanonical` — point these at the same modules
 * reconciliation-invariants.ts imports from once you've renamed them.
 */

import { runInvariantChecks } from '../src/services/reconciliation-invariants';
import { DiscrepancyType } from '../src/types/reconciliation';

jest.mock('../src/lib/supabase', () => {
  const insertedDiscrepancies: unknown[] = [];
  return {
    supabase: {
      from: (table: string) => ({
        select: () => ({
          gte: () => ({ lte: async () => ({ data: mockBackendRenewals, error: null }) }),
        }),
        insert: async (rows: unknown[]) => {
          if (table === 'reconciliation_discrepancies') insertedDiscrepancies.push(...rows);
          return { error: null };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
      rpc: async () => ({ data: '0', error: null }),
    },
    __getInsertedDiscrepancies: () => insertedDiscrepancies,
  };
});

// A backend record that claims to be confirmed, with a tx_hash that will
// NOT be found on-chain — this is the deliberately injected discrepancy
// (MISSING_ONCHAIN_TX: "database says renewed, chain says it did not").
const mockBackendRenewals = [
  {
    id: 'renewal-injected-001',
    subscription_id: 'sub-001',
    status: 'confirmed',
    tx_hash: '0xdeadbeef_does_not_exist_onchain',
    block_height: 123456,
    amount: '5000000',
    contract_id: 'CONTRACT_TEST_1',
    created_at: new Date().toISOString(),
  },
];

jest.mock('../src/services/blockchain-reconciliation-service', () => ({
  getConfirmedOnChainRenewals: async () => [], // no on-chain events at all -> injected gap
  getOnChainBalance: async () => '0',
}));

jest.mock('../src/services/reorg-handler', () => ({
  isBlockCanonical: async () => true,
  getSafeBlockHeight: async () => 123500,
}));

describe('reconciliation invariants — injected discrepancy', () => {
  it('detects a backend-confirmed renewal with no matching on-chain tx within one job interval', async () => {
    const result = await runInvariantChecks('sliding_window', 60);

    expect(result.discrepanciesFound.length).toBeGreaterThan(0);

    const found = result.discrepanciesFound.find(
      (d) => d.renewalRecordId === 'renewal-injected-001',
    );

    expect(found).toBeDefined();
    expect(found?.discrepancyType).toBe(DiscrepancyType.MISSING_ONCHAIN_TX);
    expect(found?.severity).toBe('critical');
    // Detected in this single run == detected within one job interval.
    expect(result.mode).toBe('sliding_window');
  });
});