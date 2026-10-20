import {
  RetentionRecord,
  RetentionSource,
  UsageRetentionArchiver,
  UsageRetentionRepository,
} from '../src/archival/usage-retention-archiver';

jest.mock('../src/config/database', () => ({ supabase: {} }));
jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn() },
}));

class FakeRetentionRepository implements UsageRetentionRepository {
  archived = new Map<RetentionSource, RetentionRecord[]>();
  deleted = new Map<RetentionSource, string[]>();

  async getOpenDisputeChannelIds(): Promise<Set<string>> {
    return new Set(['disputed-channel']);
  }

  async listExpired(source: RetentionSource): Promise<RetentionRecord[]> {
    if (source === 'v3_receipts') {
      return [
        { id: 'receipt-open', channelId: 'disputed-channel', data: { receiptId: 'receipt-open' } },
        { id: 'receipt-closed', channelId: 'settled-channel', data: { receiptId: 'receipt-closed' } },
      ];
    }
    if (source === 'meter_usage_ledger') {
      return [{ id: 'usage-1', data: { route: '/private/path', correlation_id: 'correlation', actual_amount: 5 } }];
    }
    return [{ id: 'aggregate-1', data: { amount: 25 } }];
  }

  async archiveAndDelete(source: RetentionSource, rows: RetentionRecord[]): Promise<void> {
    this.archived.set(source, rows);
    this.deleted.set(source, rows.map((row) => row.id));
  }
}

describe('UsageRetentionArchiver', () => {
  it('moves expired data, redacts event metadata, and retains receipts for open disputes', async () => {
    const repository = new FakeRetentionRepository();
    const archiver = new UsageRetentionArchiver(repository);
    const counts = await archiver.run(new Date('2026-10-20T00:00:00.000Z'));

    expect(counts).toEqual({
      v3_receipts: 1,
      meter_usage_ledger: 1,
      channel_payments: 1,
    });
    expect(repository.deleted.get('v3_receipts')).toEqual(['receipt-closed']);
    expect(repository.deleted.get('meter_usage_ledger')).toEqual(['usage-1']);
    expect(repository.archived.get('meter_usage_ledger')?.[0]?.data).toMatchObject({
      route: '[REDACTED_AFTER_DISPUTE_WINDOW]',
      correlation_id: null,
      settlement_ref: null,
      actual_amount: 5,
    });
  });
});
