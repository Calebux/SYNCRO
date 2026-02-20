/**
 * Tests for SubscriptionService.cancelSubscription()
 *
 * Follows the same mock pattern as user-preference-service.test.ts:
 * - Mock '../src/config/database' at factory level → avoids env var throw
 * - Mock '../src/config/logger' → silences noise
 * - Mock '../src/services/blockchain-service' → isolates DB from chain
 * - DatabaseTransaction.execute() passes the mocked supabase directly; no extra mock needed.
 */

import { subscriptionService } from '../src/services/subscription-service';
import { supabase } from '../src/config/database';
import { blockchainService } from '../src/services/blockchain-service';
import logger from '../src/config/logger';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/config/logger');

// Prevent database.ts from throwing on missing env vars
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../src/services/blockchain-service', () => ({
  blockchainService: {
    logCancellation: jest.fn(),
  },
}));

// ── Test data ────────────────────────────────────────────────────────────────

const USER_ID = 'user-001';
const SUB_ID  = 'sub-001';

const activeSubscription = {
  id: SUB_ID,
  user_id: USER_ID,
  name: 'Netflix',
  provider: 'Netflix',
  price: 15.99,
  billing_cycle: 'monthly',
  status: 'active',
  notes: null as string | null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

const cancelledSub = { ...activeSubscription, status: 'cancelled' };

// Typed references to mocks
const mockFrom        = supabase.from as jest.Mock;
const mockBlockchain  = blockchainService.logCancellation as jest.Mock;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a supabase query chain mock:
 *   .from('subscriptions').select(...).eq(...).eq(...).single()  → fetchResult
 *   .from('subscriptions').update(...).eq(...).eq(...).select(...).single() → updateResult
 */
function wireMocks(fetchResult: any, updateResult?: any) {
  mockFrom.mockImplementation(() => ({
    // SELECT branch (fetch)
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue(fetchResult),
        }),
      }),
    }),
    // UPDATE branch
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue(updateResult ?? { data: null, error: null }),
          }),
        }),
      }),
    }),
  }));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SubscriptionService.cancelSubscription()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('cancels an active subscription and returns syncStatus="synced"', async () => {
    wireMocks(
      { data: activeSubscription, error: null },
      { data: cancelledSub, error: null }
    );
    mockBlockchain.mockResolvedValue({ success: true, transactionHash: 'cx_abc123' });

    const result = await subscriptionService.cancelSubscription(USER_ID, SUB_ID, {
      cancellation_url: 'https://netflix.com/cancel',
      reason: 'Too expensive',
    });

    expect(result.syncStatus).toBe('synced');
    expect(result.subscription.status).toBe('cancelled');
    expect(result.cancellationUrl).toBe('https://netflix.com/cancel');
    expect(result.blockchainResult?.success).toBe(true);
    expect(result.blockchainResult?.transactionHash).toBe('cx_abc123');
    expect(mockBlockchain).toHaveBeenCalledWith(
      USER_ID,
      SUB_ID,
      expect.objectContaining({ status: 'cancelled' }),
      'https://netflix.com/cancel'
    );
  });

  // ── Double-cancel guard ────────────────────────────────────────────────────

  it('throws when subscription is already cancelled', async () => {
    wireMocks({ data: { ...activeSubscription, status: 'cancelled' }, error: null });

    await expect(
      subscriptionService.cancelSubscription(USER_ID, SUB_ID)
    ).rejects.toThrow('Subscription is already cancelled');

    expect(mockBlockchain).not.toHaveBeenCalled();
  });

  // ── Not found / access denied ──────────────────────────────────────────────

  it('throws when subscription is not found or user does not own it', async () => {
    wireMocks({ data: null, error: { message: 'PGRST116' } });

    await expect(
      subscriptionService.cancelSubscription('wrong-user', SUB_ID)
    ).rejects.toThrow('Subscription not found or access denied');

    expect(mockBlockchain).not.toHaveBeenCalled();
  });

  // ── Blockchain log returns failure ─────────────────────────────────────────

  it('returns syncStatus="partial" when blockchain log returns failure', async () => {
    wireMocks(
      { data: activeSubscription, error: null },
      { data: cancelledSub, error: null }
    );
    mockBlockchain.mockResolvedValue({ success: false, error: 'Contract unreachable' });

    const result = await subscriptionService.cancelSubscription(USER_ID, SUB_ID);

    expect(result.syncStatus).toBe('partial');
    expect(result.subscription.status).toBe('cancelled');
    expect(result.blockchainResult?.success).toBe(false);
    expect(result.blockchainResult?.error).toBe('Contract unreachable');
  });

  // ── Blockchain throws ──────────────────────────────────────────────────────

  it('returns syncStatus="partial" and logs error when blockchain throws', async () => {
    wireMocks(
      { data: activeSubscription, error: null },
      { data: cancelledSub, error: null }
    );
    mockBlockchain.mockRejectedValue(new Error('Network timeout'));

    const result = await subscriptionService.cancelSubscription(USER_ID, SUB_ID);

    expect(result.syncStatus).toBe('partial');
    expect(result.blockchainResult?.error).toBe('Network timeout');
    expect(logger.error).toHaveBeenCalledWith(
      'Blockchain log error (non-fatal):',
      expect.any(Error)
    );
  });
});
