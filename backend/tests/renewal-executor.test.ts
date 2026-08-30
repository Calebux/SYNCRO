import { RenewalExecutor } from '../src/services/renewal-executor';
import logger from '../src/config/logger';
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

    const mockSupabase: any = {
      from: jest.fn((table: string) => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockResolvedValue({ error: null }),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      })),
      auth: { admin: { getUserById: jest.fn() } },
    };

    const mockBlockchain = { syncSubscription: jest.fn() };
    const mockWebhook = { dispatchEvent: jest.fn().mockReturnValue(Promise.resolve()) };
    const mockChannel = { findPayableChannel: jest.fn(), applyRenewalPayment: jest.fn() };
    const mockBatcher = { enqueue: jest.fn().mockResolvedValue('settlement-1') };
    const mockStealth = { storeStealthPayment: jest.fn().mockResolvedValue(undefined) };

    executor = new RenewalExecutor({
      supabase: mockSupabase,
      logger,
      blockchainService: mockBlockchain,
      webhookService: mockWebhook,
      channelStateService: mockChannel,
      settlementBatcher: mockBatcher,
      stealthScanner: mockStealth,
      clock: { now: () => new Date() },
    } as any);
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
    (executor as any).supabase.from.mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions') return makeChain({ data: { status: 'active', next_billing_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() }, error: null });
      return makeChain({ data: null, error: null });
    });
    (executor as any).blockchainService.syncSubscription.mockResolvedValue({ success: true, transactionHash: 'tx-hash-123' });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe('tx-hash-123');
  });

  it('should fail with invalid approval', async () => {
    (executor as any).supabase.from.mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: null, error: { message: 'Not found' } });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('invalid_approval');
  });

  it('should fail when billing window invalid', async () => {
    (executor as any).supabase.from.mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions') return makeChain({ data: { status: 'active', next_billing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('billing_window_invalid');
  });

  it('should retry on retryable failures', async () => {
    (executor as any).supabase.from.mockImplementation((table: string) => {
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
    (executor as any).supabase.from.mockImplementation((table: string) => {
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
    (executor as any).supabase.from.mockImplementation((table: string) => {
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
    (executor as any).supabase.from.mockImplementation((table: string) => {
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
    (executor as any).supabase.from.mockImplementation((table: string) => {
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
    (executor as any).supabase.from.mockImplementation((table: string) => {
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
    (executor as any).supabase.from.mockImplementation((table: string) => {
      if (table === 'renewal_approvals')
        return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions')
        return makeChain({ data: { status: 'active', next_billing_date: nearBillingDate }, error: null });
      return makeChain({ data: null, error: null });
    });
    (executor as any).blockchainService.syncSubscription.mockResolvedValue({ success: true, transactionHash: 'tx-abc' });

    const result = await executor.executeRenewal(mockRequest);
    expect(result.success).toBe(true);
  });

  // I-W2: Inactive subscription must be rejected (billing_window_invalid).
  it('should reject renewal for inactive subscription (I-W2)', async () => {
    (executor as any).supabase.from.mockImplementation((table: string) => {
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
    (executor as any).channelStateService.findPayableChannel.mockResolvedValue({
      id: 'ch-99',
      state: 'active',
      balance: '100',
    });
    (executor as any).channelStateService.applyRenewalPayment.mockResolvedValue({
      id: 'ch-99',
      channelState: { sequenceNumber: 1 },
    });

    (executor as any).supabase.from.mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions') return makeChain({ data: { status: 'active', next_billing_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), billing_cycle: 'monthly' }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await executor.executeRenewal(mockRequest);

    expect(result.success).toBe(true);
    expect(result.transactionHash).toBeUndefined();
    expect((executor as any).channelStateService.applyRenewalPayment).toHaveBeenCalledWith(
      'ch-99',
      'user-456',
      'sub-123',
      9.99,
    );
    expect((executor as any).blockchainService.syncSubscription).not.toHaveBeenCalled();
  });

  it('should fall back to on-chain when channel balance insufficient', async () => {
    process.env.PAYMENT_CHANNELS_ENABLED = 'true';
    (executor as any).channelStateService.findPayableChannel.mockResolvedValue(null);

    (executor as any).supabase.from.mockImplementation((table: string) => {
      if (table === 'renewal_approvals') return makeChain({ data: { approval_id: 'approval-789', max_spend: 15.0, expires_at: null, used: false }, error: null });
      if (table === 'subscriptions') return makeChain({ data: { status: 'active', next_billing_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), billing_cycle: 'monthly' }, error: null });
      return makeChain({ data: null, error: null });
    });
    (executor as any).blockchainService.syncSubscription.mockResolvedValue({ success: true, transactionHash: 'tx-onchain' });

    const result = await executor.executeRenewal(mockRequest);

    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe('tx-onchain');
    expect((executor as any).blockchainService.syncSubscription).toHaveBeenCalled();
  });
});