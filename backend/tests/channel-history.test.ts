/**
 * Tests for the channel history service (issue #1501).
 *
 * Covers:
 *  - Ownership guard (channel not found / not owned → null).
 *  - Merged chronological timeline across open / payments / submitted states /
 *    on-chain events (open, top-up, close) with nonces and confirmation.
 *  - End-to-end decoding of on-chain event values into balances & sequences.
 *  - On-chain event attribution (a different channel's events are excluded).
 *  - Unsettled exposure = metered minus latest on-chain commitment.
 *  - Challenge window (7-day default vs on-chain value) and time remaining
 *    while a close is in flight.
 *  - Explorer links built from transaction hashes.
 */

jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../src/services/payment-channel-service', () => ({
  paymentChannelService: { getChannel: jest.fn() },
}));

import { channelHistoryService } from '../src/services/channel-history';
import { supabase } from '../src/config/database';
import { paymentChannelService } from '../src/services/payment-channel-service';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Chainable supabase query builder that resolves to fixed data. */
function builderFor(data: unknown) {
  const builder: any = {
    then(onFulfilled?: (v: unknown) => unknown) {
      return Promise.resolve({ data, error: null }).then(onFulfilled);
    },
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    ilike: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => builder,
  };
  return builder;
}

const tableData: Record<string, unknown> = {};

function mockTable(table: string, data: unknown) {
  tableData[table] = data;
  (supabase.from as jest.Mock).mockImplementation((name: string) =>
    builderFor(name in tableData ? tableData[name] : []),
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Builds a realistic `blockchain_logs` row as the indexer persists it. */
function logRow(action: string, txHash: string, ledgerClosedAt: string, value: unknown[]) {
  return {
    event_type: `channel.${action}`,
    transaction_hash: txHash,
    created_at: ledgerClosedAt,
    event_data: {
      ledger: 100,
      ledgerClosedAt,
      contractId: 'CCHANNEL',
      txHash,
      topic: ['channel', action],
      topicPath: `channel.${action}`,
      eventType: action,
      schemaVersion: 1,
      value,
    },
  };
}

const openedRow = logRow(
  'opened',
  'txkabc123',
  '2026-08-01T00:00:00.000Z',
  [
    { u64: { lo: 7, hi: 0 } },
    { address: { account: 'GUSER123' } },
    { address: { contract: 'CEXEC' } },
    { i128: { lo: 50, hi: 0 } },
    { u64: { lo: 604800, hi: 0 } },
  ],
);

const submittedRow1 = logRow(
  'submitted',
  'txsub1',
  '2026-08-15T00:00:00.000Z',
  [
    { u64: { lo: 7, hi: 0 } },
    { i128: { lo: 45, hi: 0 } },
    { i128: { lo: 5, hi: 0 } },
    { u64: { lo: 11, hi: 0 } },
  ],
);

const submittedRow2 = logRow(
  'submitted',
  'txsub2',
  '2026-09-01T00:00:00.000Z',
  [
    { u64: { lo: 7, hi: 0 } },
    { i128: { lo: 42, hi: 0 } },
    { i128: { lo: 8, hi: 0 } },
    { u64: { lo: 15, hi: 0 } },
  ],
);

const toppedupRow = logRow(
  'toppedup',
  'txtopup',
  '2026-08-10T00:00:00.000Z',
  [
    { u64: { lo: 7, hi: 0 } },
    { i128: { lo: 25, hi: 0 } },
  ],
);

const closingRow = logRow(
  'closing',
  'txclose',
  '2026-09-20T10:00:00.000Z',
  [
    { u64: { lo: 7, hi: 0 } },
    { i128: { lo: 42, hi: 0 } },
    { i128: { lo: 8, hi: 0 } },
    { u64: { lo: 15, hi: 0 } },
  ],
);

const otherChannelRow = logRow('submitted', 'txother', '2026-08-15T00:00:00.000Z', [
  { u64: { lo: 99, hi: 0 } },
  { i128: { lo: 1, hi: 0 } },
  { i128: { lo: 2, hi: 0 } },
  { u64: { lo: 3, hi: 0 } },
]);

const channelRecord: any = {
  id: 'chan-1',
  userId: 'user-1',
  counterparty: 'SYNCRO Executor',
  balance: '8.00',
  state: 'closing',
  lastUpdated: '2026-09-20T10:00:00.000Z',
  channelState: {
    sequenceNumber: 15,
    userBalance: 8,
    executorBalance: 42,
    totalDeposited: 50,
  },
  onChainChannelId: '7',
};

const rawRow = {
  channel_id: '7',
  opened_at: '2026-08-01T00:00:00.000Z',
  deposit_amount: 50,
  updated_at: '2026-09-20T10:00:00.000Z',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChannelHistoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(tableData)) delete tableData[key];
    (paymentChannelService.getChannel as jest.Mock).mockResolvedValue(channelRecord);
  });

  it('returns null when the channel does not exist / is not owned', async () => {
    (paymentChannelService.getChannel as jest.Mock).mockResolvedValue(null);
    await expect(channelHistoryService.getHistory('user-1', 'missing')).resolves.toBeNull();
  });

  it('merges the full timeline chronologically with nonces, sequences and explorer links', async () => {
    mockTable('payment_channels', rawRow);
    mockTable('channel_states', [
      { id: 1, channel_id: 'chan-1', state_number: '1', balance: 45, nonce: 'n1', confirmed: true, created_at: '2026-08-02T00:00:00.000Z' },
      { id: 2, channel_id: 'chan-1', state_number: '2', balance: 40, nonce: 'n2', confirmed: false, created_at: '2026-08-20T00:00:00.000Z' },
    ]);
    mockTable('channel_payments', [
      { id: 'p1', subscription_id: 'sub-1', amount: 5, sequence_number: 3, created_at: '2026-08-05T00:00:00.000Z' },
      { id: 'p2', subscription_id: 'sub-2', amount: 5, sequence_number: 6, created_at: '2026-08-12T00:00:00.000Z' },
    ]);
    mockTable('blockchain_logs', [
      openedRow,
      toppedupRow,
      submittedRow1,
      submittedRow2,
      closingRow,
      otherChannelRow,
    ]);

    const result = await channelHistoryService.getHistory('user-1', 'chan-1');
    expect(result).not.toBeNull();

    // On-chain attribution: the other channel's event must be excluded.
    const hashes = result!.events.map((e) => e.transactionHash).filter(Boolean);
    expect(hashes).not.toContain('txother');

    const types = result!.events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(['open', 'payment', 'topup', 'state_submitted', 'close_initiated']),
    );

    // Chronological ascending.
    const times = result!.events.map((e) => Date.parse(e.timestamp));
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);

    // Off-chain submitted states carry nonce + state number + confirmation.
    const states = result!.events.filter((e) => e.type === 'state_submitted' && e.source === 'off-chain');
    expect(states).toHaveLength(2);
    expect(states[0].nonce).toBe('n1');
    expect(states[0].stateNumber).toBe(1);
    expect(states[0].confirmed).toBe(true);
    expect(states[1].nonce).toBe('n2');
    expect(states[1].confirmed).toBe(false);

    // On-chain events carry tx hashes and explorer links.
    const onChain = result!.events.filter((e) => e.source === 'on-chain');
    expect(onChain.length).toBeGreaterThan(0);
    for (const event of onChain) {
      expect(event.transactionHash).toBeTruthy();
      expect(event.explorerUrl).toBe(
        `https://stellar.expert/explorer/testnet/tx/${event.transactionHash}`,
      );
    }

    // On-chain submitted states expose sequence + balances.
    const sub2 = result!.events.find((e) => e.transactionHash === 'txsub2');
    expect(sub2).toMatchObject({ type: 'state_submitted', sequenceNumber: 15, stateNumber: 15 });
  });

  it('computes unsettled exposure as metered minus the latest on-chain commitment', async () => {
    mockTable('payment_channels', rawRow);
    mockTable('channel_states', []);
    mockTable('channel_payments', []);
    mockTable('blockchain_logs', [openedRow, submittedRow1, submittedRow2]);

    const result = await channelHistoryService.getHistory('user-1', 'chan-1');
    expect(result!.financials.committedOnChain).toMatchObject({
      balanceA: 42,
      balanceB: 8,
      sequence: 15,
      transactionHash: 'txsub2',
    });
    // 42 metered − 8 committed = 34 unsettled.
    expect(result!.financials.unsettled).toBe(34);
    expect(result!.financials.meteredBalance).toBe(42);
    expect(result!.financials.userBalance).toBe(8);
  });

  it('treats the full metered balance as unsettled when nothing is committed on-chain', async () => {
    mockTable('payment_channels', rawRow);
    mockTable('channel_states', []);
    mockTable('channel_payments', []);
    mockTable('blockchain_logs', []);

    const result = await channelHistoryService.getHistory('user-1', 'chan-1');
    expect(result!.financials.committedOnChain).toBeNull();
    expect(result!.financials.unsettled).toBe(42);
  });

  it('surfaces the challenge window from the on-chain opened event while a close is in flight', async () => {
    const openedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const deadline = new Date(Date.parse(openedAt) + 604800 * 1000).toISOString();

    mockTable('payment_channels', rawRow);
    mockTable('channel_states', []);
    mockTable('channel_payments', []);
    mockTable('blockchain_logs', [logRow('opened', 'txkabc123', openedAt, [
      { u64: { lo: 7, hi: 0 } },
      { address: { account: 'GUSER123' } },
      { address: { contract: 'CEXEC' } },
      { i128: { lo: 50, hi: 0 } },
      { u64: { lo: 604800, hi: 0 } },
    ]), closingRow]);

    const result = await channelHistoryService.getHistory('user-1', 'chan-1');
    expect(result!.challenge.periodActive).toBe(true);
    expect(result!.challenge.source).toBe('on-chain');
    expect(result!.challenge.windowSeconds).toBe(604800);
    expect(result!.challenge.windowDays).toBe(7);
    expect(result!.challenge.deadline).toBe(deadline);
    expect(result!.challenge.remainingSeconds).toBeGreaterThan(0);
  });

  it('falls back to the default 7-day window and is inactive for open channels', async () => {
    (paymentChannelService.getChannel as jest.Mock).mockResolvedValue({
      ...channelRecord,
      state: 'active',
      lastUpdated: '2026-09-01T00:00:00.000Z',
    });
    mockTable('payment_channels', { ...rawRow, updated_at: '2026-09-01T00:00:00.000Z' });
    mockTable('channel_states', []);
    mockTable('channel_payments', []);
    mockTable('blockchain_logs', []);

    const result = await channelHistoryService.getHistory('user-1', 'chan-1');
    expect(result!.challenge.periodActive).toBe(false);
    expect(result!.challenge.remainingSeconds).toBeNull();
    expect(result!.challenge.windowDays).toBe(7);
    expect(result!.challenge.source).toBe('default');
  });
});