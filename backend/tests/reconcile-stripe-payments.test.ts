import { beforeEach, describe, expect, it, jest } from '@jest/globals';
const { reconcile } = require('../../scripts/reconcile-stripe-payments');

describe('reconcile-stripe-payments script', () => {
  let mockSupabase: any;
  let mockStripe: any;
  let mockLogger: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
    };

    mockStripe = {
      paymentIntents: {
        retrieve: jest.fn(),
      },
    };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  it('should reconcile a pending payment that succeeded in Stripe', async () => {
    // 1. Setup mock data
    const pendingPayment = {
      id: 'pay_123',
      transaction_id: 'pi_abc',
      status: 'pending',
    };

    mockSupabase.lt.mockResolvedValue({ data: [pendingPayment], error: null });
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_abc',
      status: 'succeeded',
      metadata: {
        userId: 'user_456',
        planName: 'Pro Plan',
      },
    });

    // 2. Run reconciliation
    await reconcile({
      supabaseClient: mockSupabase,
      stripeClient: mockStripe,
      logger: mockLogger,
    });

    // 3. Verify interactions
    expect(mockSupabase.from).toHaveBeenCalledWith('payments');
    expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
    expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'pay_123');
    
    // Verify profile update
    expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
    expect(mockSupabase.update).toHaveBeenCalledWith({ subscription_tier: 'Pro Plan' });
    expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'user_456');

    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('✅ Reconciled payment pay_123 -> succeeded'));
  });

  it('should mark a payment as failed if Stripe says it was canceled', async () => {
    const pendingPayment = {
      id: 'pay_789',
      transaction_id: 'pi_xyz',
      status: 'pending',
    };

    mockSupabase.lt.mockResolvedValue({ data: [pendingPayment], error: null });
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_xyz',
      status: 'canceled',
    });

    await reconcile({
      supabaseClient: mockSupabase,
      stripeClient: mockStripe,
      logger: mockLogger,
    });

    expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('❌ Marked payment pay_789 as failed'));
  });
});
