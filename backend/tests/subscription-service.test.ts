import { subscriptionService } from '../src/services/subscription-service';
import { supabase } from '../src/config/database';
import { blockchainService } from '../src/services/blockchain-service';

// Mock Supabase client
jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

// Mock logger
jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

// Mock blockchain service
jest.mock('../src/services/blockchain-service', () => ({
  blockchainService: {
    syncSubscription: jest.fn(),
  },
}));

// Mock renewal cooldown service
jest.mock('../src/services/renewal-cooldown-service', () => ({
  renewalCooldownService: {
    checkCooldown: () => Promise.resolve({ isOnCooldown: false, canRetry: true, timeRemainingSeconds: 0, lastAttemptAt: null }),
    recordRenewalAttempt: () => Promise.resolve({ new_attempt_at: new Date().toISOString() }),
  },
}));

// Mock DatabaseTransaction
jest.mock('../src/utils/transaction', () => ({
  DatabaseTransaction: {
    execute: jest.fn(),
  },
}));

// Mock renewalCooldownService to avoid supabase chain complexity in retryBlockchainSync tests
jest.mock('../src/services/renewal-cooldown-service', () => ({
  renewalCooldownService: {
    checkCooldown: jest.fn(),
    recordRenewalAttempt: jest.fn(),
  },
}));

import { renewalCooldownService } from '../src/services/renewal-cooldown-service';

describe('SubscriptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply defaults after resetMocks clears them
    (renewalCooldownService.checkCooldown as jest.Mock).mockResolvedValue({
      canRetry: true,
      isOnCooldown: false,
      timeRemainingSeconds: 0,
    });
    (renewalCooldownService.recordRenewalAttempt as jest.Mock).mockResolvedValue({
      previous_attempt_at: null,
      new_attempt_at: new Date().toISOString(),
    });
  });

  describe('getSubscription()', () => {
    it('should retrieve a subscription successfully', async () => {
      const mockSubscription = {
        id: 'sub-123',
        user_id: 'user-123',
        name: 'Netflix',
        provider: 'Netflix',
        price: 15.99,
        billing_cycle: 'monthly',
        status: 'active',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockSubscription,
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await subscriptionService.getSubscription('user-123', 'sub-123');

      expect(supabase.from).toHaveBeenCalledWith('subscriptions');
      expect(mockQuery.select).toHaveBeenCalledWith('*');
      expect(mockQuery.eq).toHaveBeenNthCalledWith(1, 'id', 'sub-123');
      expect(mockQuery.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-123');
      expect(result).toEqual(mockSubscription);
    });

    it('should throw error when subscription not found', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'No rows found' },
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await expect(
        subscriptionService.getSubscription('user-123', 'non-existent')
      ).rejects.toThrow('Subscription not found or access denied');
    });

    it('should throw error on database error', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await expect(
        subscriptionService.getSubscription('user-123', 'sub-123')
      ).rejects.toThrow('Subscription not found or access denied');
    });

    it('should prevent access to other users subscriptions', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await expect(
        subscriptionService.getSubscription('user-456', 'sub-123')
      ).rejects.toThrow('Subscription not found or access denied');
    });
  });

  describe('createSubscription()', () => {
    it('should create a subscription with successful blockchain sync', async () => {
      const createInput = {
        name: 'Netflix',
        provider: 'Netflix',
        price: 15.99,
        billing_cycle: 'monthly' as const,
        status: 'active' as const,
      };

      const mockInsertedSub = {
        id: 'sub-456',
        user_id: 'user-123',
        ...createInput,
        created_at: '2024-02-01T00:00:00Z',
        updated_at: '2024-02-01T00:00:00Z',
      };

      const mockInsertQuery = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockInsertedSub,
          error: null,
        }),
      };

      const mockClient = {
        from: jest.fn().mockReturnValue(mockInsertQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({
        success: true,
        transactionHash: 'hash-123',
      });

      const result = await subscriptionService.createSubscription('user-123', createInput);

      expect(result.subscription).toBeDefined();
      expect(result.syncStatus).toBe('synced');
      expect(result.blockchainResult).toBeDefined();
    });

    it('should handle partial sync when blockchain sync fails', async () => {
      const createInput = {
        name: 'Spotify',
        price: 10.99,
        billing_cycle: 'monthly' as const,
      };

      const mockInsertedSub = {
        id: 'sub-789',
        user_id: 'user-123',
        name: createInput.name,
        provider: createInput.name,
        price: createInput.price,
        billing_cycle: createInput.billing_cycle,
        status: 'active',
        created_at: '2024-02-01T00:00:00Z',
        updated_at: '2024-02-01T00:00:00Z',
      };

      const mockInsertQuery = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockInsertedSub,
          error: null,
        }),
      };

      const mockClient = {
        from: jest.fn().mockReturnValue(mockInsertQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      const result = await subscriptionService.createSubscription('user-123', createInput);

      expect(result.syncStatus).toBe('partial');
      expect(result.blockchainResult?.success).toBe(false);
    });

    it('should handle blockchain connection errors gracefully', async () => {
      const createInput = {
        name: 'Hulu',
        price: 7.99,
        billing_cycle: 'monthly' as const,
      };

      const mockInsertedSub = {
        id: 'sub-999',
        user_id: 'user-123',
        name: createInput.name,
        provider: createInput.name,
        price: createInput.price,
        billing_cycle: createInput.billing_cycle,
        status: 'active',
        created_at: '2024-02-01T00:00:00Z',
        updated_at: '2024-02-01T00:00:00Z',
      };

      const mockInsertQuery = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockInsertedSub,
          error: null,
        }),
      };

      const mockClient = {
        from: jest.fn().mockReturnValue(mockInsertQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      (blockchainService.syncSubscription as jest.Mock).mockRejectedValue(
        new Error('Connection timeout')
      );

      const result = await subscriptionService.createSubscription('user-123', createInput);

      expect(result.syncStatus).toBe('partial');
      expect(result.blockchainResult?.error).toContain('Connection timeout');
    });
  });

  describe('updateSubscription()', () => {
    const existingSubscription = {
      id: 'sub-123',
      user_id: 'user-123',
      name: 'Netflix',
      provider: 'Netflix',
      price: 15.99,
      status: 'active',
      updated_at: '2024-01-01T00:00:00Z',
    };

    it('should update subscription with successful blockchain sync', async () => {
      const updateInput = {
        price: 22.99,
        status: 'paused' as const,
      };

      const mockSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: existingSubscription,
          error: null,
        }),
      };

      const mockUpdateQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { ...existingSubscription, ...updateInput },
          error: null,
        }),
      };

      const mockClient = {
        from: jest
          .fn()
          .mockReturnValueOnce(mockSelectQuery)
          .mockReturnValueOnce(mockUpdateQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({
        success: true,
        transactionHash: 'hash-update-123',
      });

      const result = await subscriptionService.updateSubscription(
        'user-123',
        'sub-123',
        updateInput
      );

      expect(result.syncStatus).toBe('synced');
      expect(result.subscription.price).toBe(22.99);
    });

    it('should throw error when subscription not found', async () => {
      const updateInput = { price: 20 };

      const mockSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      const mockClient = {
        from: jest.fn().mockReturnValue(mockSelectQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      await expect(
        subscriptionService.updateSubscription('user-123', 'non-existent', updateInput)
      ).rejects.toThrow('Subscription not found or access denied');
    });

    it('should prevent unauthorized updates', async () => {
      const updateInput = { price: 20 };

      const mockSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      const mockClient = {
        from: jest.fn().mockReturnValue(mockSelectQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      await expect(
        subscriptionService.updateSubscription('hacker-user', 'sub-123', updateInput)
      ).rejects.toThrow('Subscription not found or access denied');
    });

    it('should handle undefined update fields gracefully', async () => {
      const updateInput = {
        price: 20,
        name: undefined,
      };

      const mockSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: existingSubscription,
          error: null,
        }),
      };

      const mockUpdateQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { ...existingSubscription, price: 20 },
          error: null,
        }),
      };

      const mockClient = {
        from: jest
          .fn()
          .mockReturnValueOnce(mockSelectQuery)
          .mockReturnValueOnce(mockUpdateQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({
        success: true,
        transactionHash: 'hash-123',
      });

      const result = await subscriptionService.updateSubscription(
        'user-123',
        'sub-123',
        updateInput
      );

      expect(result.syncStatus).toBe('synced');
    });
  });

  describe('cancelSubscription()', () => {
    it('should cancel a subscription successfully', async () => {
      const activeSubscription = {
        id: 'sub-123',
        user_id: 'user-123',
        name: 'Netflix',
        status: 'active',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const mockSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: activeSubscription,
          error: null,
        }),
      };

      const mockUpdateQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { ...activeSubscription, status: 'cancelled' },
          error: null,
        }),
      };

      const mockClient = {
        from: jest
          .fn()
          .mockReturnValueOnce(mockSelectQuery)
          .mockReturnValueOnce(mockUpdateQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({
        success: true,
        transactionHash: 'hash-cancel-123',
      });

      const result = await subscriptionService.cancelSubscription(
        'user-123',
        'sub-123'
      );

      expect(result.subscription.status).toBe('cancelled');
      expect(result.syncStatus).toBe('synced');
    });

    it('should throw error when trying to cancel non-existent subscription', async () => {
      const mockSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      const mockClient = {
        from: jest.fn().mockReturnValue(mockSelectQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      await expect(
        subscriptionService.cancelSubscription('user-123', 'non-existent')
      ).rejects.toThrow('Subscription not found or access denied');
    });

    it('should throw error when trying to cancel already cancelled subscription', async () => {
      const cancelledSubscription = {
        id: 'sub-123',
        user_id: 'user-123',
        name: 'Netflix',
        status: 'cancelled',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const mockSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: cancelledSubscription,
          error: null,
        }),
      };

      const mockClient = {
        from: jest.fn().mockReturnValue(mockSelectQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      await expect(
        subscriptionService.cancelSubscription('user-123', 'sub-123')
      ).rejects.toThrow('Subscription already cancelled');
    });

    it('should handle blockchain sync failure gracefully', async () => {
      const activeSubscription = {
        id: 'sub-123',
        user_id: 'user-123',
        name: 'Netflix',
        status: 'active',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const mockSelectQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: activeSubscription,
          error: null,
        }),
      };

      const mockUpdateQuery = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { ...activeSubscription, status: 'cancelled' },
          error: null,
        }),
      };

      const mockClient = {
        from: jest
          .fn()
          .mockReturnValueOnce(mockSelectQuery)
          .mockReturnValueOnce(mockUpdateQuery),
      };

      const { DatabaseTransaction } = require('../src/utils/transaction');
      (DatabaseTransaction.execute as jest.Mock).mockImplementation((callback) =>
        callback(mockClient)
      );

      (blockchainService.syncSubscription as jest.Mock).mockRejectedValue(
        new Error('Blockchain unavailable')
      );

      const result = await subscriptionService.cancelSubscription(
        'user-123',
        'sub-123'
      );

      expect(result.subscription.status).toBe('cancelled');
      expect(result.syncStatus).toBe('partial');
    });
  });

  describe('listSubscriptions()', () => {
    it('should list all subscriptions for a user', async () => {
      const mockSubscriptions = [
        { id: 'sub-1', name: 'Netflix', status: 'active' },
        { id: 'sub-2', name: 'Spotify', status: 'active' },
      ];

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: mockSubscriptions,
          error: null,
          count: 2,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await subscriptionService.listSubscriptions('user-123');

      expect(result.subscriptions.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should filter subscriptions by status', async () => {
      const mockSubscriptions = [
        { id: 'sub-1', name: 'Netflix', status: 'active' },
      ];

      const mockQuery: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation((resolve: any) => resolve({
          data: mockSubscriptions,
          error: null,
          count: 1,
        })),
      };
      // Make the last eq call resolve
      mockQuery.eq
        .mockReturnValueOnce(mockQuery) // user_id eq
        .mockReturnValueOnce(mockQuery); // status eq

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await subscriptionService.listSubscriptions('user-123', {
        status: 'active',
      });

      expect(result.subscriptions).toEqual(mockSubscriptions);
    });

    it('should filter subscriptions by category', async () => {
      const mockSubscriptions = [
        { id: 'sub-1', name: 'Netflix', category: 'entertainment' },
      ];

      const mockQuery: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation((resolve: any) => resolve({
          data: mockSubscriptions,
          error: null,
          count: 1,
        })),
      };
      mockQuery.eq
        .mockReturnValueOnce(mockQuery) // user_id eq
        .mockReturnValueOnce(mockQuery); // category eq

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await subscriptionService.listSubscriptions('user-123', {
        category: 'entertainment',
      });

      expect(result.subscriptions).toEqual(mockSubscriptions);
    });

    it('should handle pagination with limit and offset', async () => {
      const mockSubscriptions = [
        { id: 'sub-5', name: 'Service 5' },
      ];

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({
          data: mockSubscriptions,
          error: null,
          count: 10,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await subscriptionService.listSubscriptions('user-123', {
        limit: 10,
        offset: 40,
      });

      expect(mockQuery.range).toHaveBeenCalledWith(40, 49);
      expect(result.subscriptions.length).toBe(1);
    });

    it('should handle empty results gracefully', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [],
          error: null,
          count: 0,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await subscriptionService.listSubscriptions('user-456');

      expect(result.subscriptions).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should throw error on database failure', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await expect(
        subscriptionService.listSubscriptions('user-123')
      ).rejects.toThrow();
    });
  });

  describe('retryBlockchainSync()', () => {
    it('should retry blockchain sync for a subscription', async () => {
      const mockSubscription = {
        id: 'sub-123',
        user_id: 'user-123',
        name: 'Netflix',
        status: 'active',
      };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockSubscription,
          error: null,
        }),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({
        success: true,
        transactionHash: 'hash-retry-123',
      });

      const result = await subscriptionService.retryBlockchainSync(
        'user-123',
        'sub-123'
      );

      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('hash-retry-123');
      expect(blockchainService.syncSubscription).toHaveBeenCalledWith(
        'user-123',
        'sub-123',
        'update',
        mockSubscription
      );
    });

    it('should handle retry failure gracefully', async () => {
      const mockSubscription = {
        id: 'sub-123',
        user_id: 'user-123',
        name: 'Netflix',
        status: 'active',
      };

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: mockSubscription,
          error: null,
        }),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      (blockchainService.syncSubscription as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Network timeout',
      });

      const result = await subscriptionService.retryBlockchainSync(
        'user-123',
        'sub-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network');
    });

    it('should throw error when subscription not found', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await expect(
        subscriptionService.retryBlockchainSync('user-123', 'non-existent')
      ).rejects.toThrow('Subscription not found or access denied');
    });
  });
});
