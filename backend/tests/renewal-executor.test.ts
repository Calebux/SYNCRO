jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/services/blockchain-service', () => ({
  blockchainService: { syncSubscription: jest.fn() },
}));

jest.mock('../src/services/webhook-service', () => ({
  webhookService: { dispatchEvent: jest.fn().mockReturnValue(Promise.resolve()) },
}));

jest.mock('@syncro/shared/crypto', () => ({
  deriveEphemeralStealthAddress: jest.fn().mockReturnValue({
    ephemeralPubkey: 'aa'.repeat(32),
    stealthAddress: 'bb'.repeat(32),
  }),
}));

jest.mock('../src/services/stealth-scanner', () => ({
  stealthScanner: { storeStealthPayment: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../src/services/settlement-batcher', () => ({
  settlementBatcher: { enqueue: jest.fn().mockResolvedValue('settlement-1') },
}));

jest.mock('../src/services/channel-state', () => ({
  channelStateService: {
    findPayableChannel: jest.fn(),
    applyRenewalPayment: jest.fn(),
  },
}));

import { RenewalExecutor } from '../src/services/renewal-executor';
import { supabase } from '../src/config/database';
import { blockchainService } from '../src/services/blockchain-service';
import { channelStateService } from '../src/services/channel-state';

describe('RenewalExecutor', () => {
  let executor: RenewalExecutor;
  const mockRequest = {
    subscriptionId: 'sub-123',
    userId: 'user-456',
    approvalId: 'approval-789',
    amount: 9.99,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_CHANNELS_ENABLED = 'false';
    executor = new RenewalExecutor();
  });

  function makeChain(resolvedValue: any) {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ error: null }),
      single: jest.fn().mockResolvedValue(resolvedValue),
    };
  }

  it('should execute renewal successfully', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions') return makeChain({ data: { status: 'active', next_billing_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() }, error: null });
      return makeChain({ data: null, error: null });
    });
    (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({ success: true, transactionHash: 'tx-hash-123' });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe('tx-hash-123');
  });

  it('should fail with invalid approval', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: null, error: { message: 'Not found' } });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('invalid_approval');
  });

  it('should fail when billing window invalid', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions') return makeChain({ data: { status: 'active', next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('billing_window_invalid');
  });

  it('should retry on retryable failures', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      // Throw for the first attempt to trigger execution_error
      if (table === 'renewal_approvals') throw new Error('Database connection failed');
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewalWithRetry(mockRequest, 2);
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('execution_error');
  });

  // ── Approval-window invariant tests (I-A1..I-A5) ──────────────

  // I-A1: Approval is single-use — a used approval must be rejected.
  it('should reject a used approval (I-A1)', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals')
        return makeChain({ data: null, error: { message: 'Not found' } });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('invalid_approval');
  });

  // I-A2: Expired approval must be rejected.
  it('should reject an expired approval (I-A2)', async () => {
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals')
        return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: pastDate, used: false }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('invalid_approval');
  });

  // I-A3: Amount exceeding max_spend must be rejected.
  it('should reject when amount exceeds max_spend (I-A3)', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals')
        // max_spend is 5.00 but request amount is 9.99
        return makeChain({ data: { approval_id: 'approval-789', max_spend: 5.0, expires_at: null, used: false }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('invalid_approval');
  });

  // I-A4: Missing approval must be rejected.
  it('should reject when approval is not found (I-A4)', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals')
        return makeChain({ data: null, error: { message: 'Not found' } });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('invalid_approval');
  });

  // ── Renewal-window invariant tests (I-W1..I-W3) ───────────────

  // I-W2: Renewal must fail when current time is before billing_start (too early).
  it('should reject renewal when too early for billing window (I-W2)', async () => {
    const farFutureBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals')
        return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions')
        return makeChain({ data: { status: 'active', next_billing_date: farFutureBillingDate }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('billing_window_invalid');
  });

  // I-W3: Renewal must succeed when no window constraint applies (billing date within 7 days).
  it('should allow renewal when within the 7-day billing window (I-W3)', async () => {
    const nearBillingDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals')
        return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions')
        return makeChain({ data: { status: 'active', next_billing_date: nearBillingDate }, error: null });
      return makeChain({ data: null, error: null });
    });
    (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({ success: true, transactionHash: 'tx-abc' });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(true);
  });

  // I-W2: Inactive subscription must be rejected (billing_window_invalid).
  it('should reject renewal for inactive subscription (I-W2)', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals')
        return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions')
        return makeChain({ data: { status: 'cancelled', next_billing_date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString() }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('billing_window_invalid');
  });

  // Payment channel tests
  it('should use off-chain channel payment when available', async () => {
    process.env.PAYMENT_CHANNELS_ENABLED = 'true';
    (channelStateService.findPayableChannel as jest.Mock).mockResolvedValue({
      id: 'ch-99',
      state: 'active',
      balance: '100',
    });
    (channelStateService.applyRenewalPayment as jest.Mock).mockResolvedValue({
      id: 'ch-99',
      channelState: { sequenceNumber: 1 },
    });

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions') return makeChain({ data: { status: 'active', next_billing_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), billing_cycle: 'monthly' }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);

    expect(result.success).toBe(true);
    expect(result.transactionHash).toBeUndefined();
    expect(channelStateService.applyRenewalPayment).toHaveBeenCalledWith(
      'ch-99',
      'user-456',
      'sub-123',
      9.99,
    );
    expect(blockchainService.syncSubscription).not.toHaveBeenCalled();
  });

  it('should fall back to on-chain when channel balance insufficient', async () => {
    process.env.PAYMENT_CHANNELS_ENABLED = 'true';
    (channelStateService.findPayableChannel as jest.Mock).mockResolvedValue(null);

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions') return makeChain({ data: { status: 'active', next_billing_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), billing_cycle: 'monthly' }, error: null });
      return makeChain({ data: null, error: null });
    });
    (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({ success: true, transactionHash: 'tx-onchain' });

    const result = await executor.executeRenewal(mockRequest);

    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe('tx-onchain');
    expect(blockchainService.syncSubscription).toHaveBeenCalled();
  });
});