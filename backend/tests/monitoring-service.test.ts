import { monitoringService } from '../src/services/monitoring-service';
import { supabase } from '../src/config/database';

// ─── Helper ──────────────────────────────────────────────────────────────────

const createMockQuery = (data: any, error: any = null, count: number = 0) => {
  const query: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error }),
    maybeSingle: jest.fn().mockResolvedValue({ data, error }),
    then: jest.fn().mockImplementation(function (resolve) {
      return Promise.resolve({
        data,
        error,
        count: count || (Array.isArray(data) ? data.length : 0),
      }).then(resolve);
    }),
  };
  return query;
};

const mockChain = createMockQuery(null);

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(() => mockChain),
    rpc: jest.fn().mockResolvedValue({ data: null, error: new Error('RPC not implemented') }),
  },
  monitorPool: jest.fn(() => ({
    activeConnections: 0,
    idleConnections: 10,
    totalRequests: 0,
    leakWarnings: 0,
  })),
}));

jest.mock('../src/config/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  __esModule: true,
}));

// ─── Existing test suites ────────────────────────────────────────────────────

describe('MonitoringService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: new Error('RPC not implemented') });
  });

  // ── getSubscriptionMetrics ──────────────────────────────────────────────────

  describe('getSubscriptionMetrics()', () => {
    it('should calculate subscription metrics correctly', async () => {
      const mockSubscriptions = [
        { category: 'entertainment', price: 15.99, status: 'active', billing_cycle: 'monthly' },
        { category: 'productivity', price: 120, status: 'active', billing_cycle: 'yearly' },
        { category: 'entertainment', price: 10.99, status: 'cancelled', billing_cycle: 'monthly' },
      ];

      const mockQuery = createMockQuery(mockSubscriptions);
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getSubscriptionMetrics();

      expect(metrics.total_subscriptions).toBe(3);
      expect(metrics.active_subscriptions).toBe(2);
      expect(metrics.category_distribution['entertainment']).toBe(2);
      expect(metrics.category_distribution['productivity']).toBe(1);
    });

    it('should calculate monthly revenue correctly for different billing cycles', async () => {
      const mockSubscriptions = [
        { category: 'entertainment', price: 12, status: 'active', billing_cycle: 'monthly' },
        { category: 'productivity', price: 120, status: 'active', billing_cycle: 'yearly' },
        { category: 'tools', price: 5, status: 'active', billing_cycle: 'weekly' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: mockSubscriptions, error: null }).then(resolve);
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getSubscriptionMetrics();

      // Monthly: 12 | Yearly: 120/12 = 10 | Weekly: 5*4 = 20 → total 42
      expect(metrics.total_monthly_revenue).toBe(42);
    });

    it('should exclude cancelled subscriptions from revenue calculation', async () => {
      const mockSubscriptions = [
        { category: 'entertainment', price: 15.99, status: 'active', billing_cycle: 'monthly' },
        { category: 'entertainment', price: 10.99, status: 'cancelled', billing_cycle: 'monthly' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: mockSubscriptions, error: null }).then(resolve);
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getSubscriptionMetrics();

      expect(metrics.total_monthly_revenue).toBe(15.99);
    });

    it('should handle empty subscription list', async () => {
      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockResolvedValue({ data: [], error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getSubscriptionMetrics();

      expect(metrics.total_subscriptions).toBe(0);
      expect(metrics.active_subscriptions).toBe(0);
      expect(metrics.total_monthly_revenue).toBe(0);
      expect(Object.keys(metrics.category_distribution).length).toBe(0);
    });

    it('should handle null categories gracefully', async () => {
      const mockSubscriptions = [
        { category: null as any, price: 15.99, status: 'active', billing_cycle: 'monthly' },
        { category: 'entertainment', price: 10.99, status: 'active', billing_cycle: 'monthly' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({
            data: mockSubscriptions,
            error: null,
            count: mockSubscriptions.length,
          }).then(resolve);
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getSubscriptionMetrics();

      expect(metrics.total_subscriptions).toBe(2);
      expect(metrics.category_distribution['entertainment']).toBe(1);
    });

    it('should throw error on database failure', async () => {
      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockResolvedValue({ data: null, error: new Error('Database error') }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await expect(monitoringService.getSubscriptionMetrics()).rejects.toThrow('Database error');
    });
  });

  // ── getRenewalMetrics ───────────────────────────────────────────────────────

  describe('getRenewalMetrics()', () => {
    it('should calculate renewal metrics correctly', async () => {
      const mockDeliveries = [
        { channel: 'email', status: 'sent' },
        { channel: 'email', status: 'sent' },
        { channel: 'sms', status: 'sent' },
        { channel: 'email', status: 'failed' },
        { channel: 'sms', status: 'failed' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: mockDeliveries, error: null }).then(resolve);
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getRenewalMetrics();

      expect(metrics.total_delivery_attempts).toBe(5);
      expect(metrics.success_rate).toBe(60);
      expect(metrics.failure_rate).toBe(40);
    });

    it('should distribute metrics by channel correctly', async () => {
      const mockDeliveries = [
        { channel: 'email', status: 'sent' },
        { channel: 'email', status: 'sent' },
        { channel: 'email', status: 'failed' },
        { channel: 'sms', status: 'sent' },
        { channel: 'sms', status: 'failed' },
        { channel: 'push', status: 'sent' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: mockDeliveries, error: null }).then(resolve);
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getRenewalMetrics();

      expect(metrics.channel_distribution['email']).toEqual({ success: 2, failure: 1 });
      expect(metrics.channel_distribution['sms']).toEqual({ success: 1, failure: 1 });
      expect(metrics.channel_distribution['push']).toEqual({ success: 1, failure: 0 });
    });

    it('should handle empty delivery list', async () => {
      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockResolvedValue({ data: [], error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getRenewalMetrics();

      expect(metrics.total_delivery_attempts).toBe(0);
      expect(metrics.success_rate).toBe(0);
      expect(metrics.failure_rate).toBe(0);
      expect(Object.keys(metrics.channel_distribution).length).toBe(0);
    });

    it('should handle 100% success rate', async () => {
      const mockDeliveries = [
        { channel: 'email', status: 'sent' },
        { channel: 'sms', status: 'sent' },
        { channel: 'push', status: 'sent' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: mockDeliveries, error: null }).then(resolve);
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getRenewalMetrics();

      expect(metrics.success_rate).toBe(100);
      expect(metrics.failure_rate).toBe(0);
    });

    it('should handle 100% failure rate', async () => {
      const mockDeliveries = [
        { channel: 'email', status: 'failed' },
        { channel: 'sms', status: 'failed' },
        { channel: 'push', status: 'failed' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: mockDeliveries, error: null }).then(resolve);
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getRenewalMetrics();

      expect(metrics.success_rate).toBe(0);
      expect(metrics.failure_rate).toBe(100);
    });

    it('should ignore unknown status values', async () => {
      const mockDeliveries = [
        { channel: 'email', status: 'sent' },
        { channel: 'email', status: 'failed' },
        { channel: 'email', status: 'pending' },
        { channel: 'email', status: 'retrying' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: mockDeliveries, error: null }).then(resolve);
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getRenewalMetrics();

      expect(metrics.total_delivery_attempts).toBe(4);
      expect(metrics.success_rate).toBe(25);
      expect(metrics.failure_rate).toBe(25);
    });

    it('should throw error on database failure', async () => {
      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockResolvedValue({ data: null, error: new Error('Database error') }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await expect(monitoringService.getRenewalMetrics()).rejects.toThrow('Database error');
    });
  });

  // ── getAgentActivity ────────────────────────────────────────────────────────

  describe('getAgentActivity()', () => {
    it('should retrieve agent activity metrics', async () => {
      const mockReminders = { count: 25 };
      const mockProcessed = { count: 150 };
      const mockLogs = [
        { status: 'confirmed' },
        { status: 'confirmed' },
        { status: 'failed' },
      ];

      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue(mockReminders),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockResolvedValue(mockProcessed),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: mockLogs, error: null }),
        });

      const activity = await monitoringService.getAgentActivity();

      expect(activity.pending_reminders).toBe(25);
      expect(activity.processed_reminders_last_24h).toBe(150);
      expect(activity.confirmed_blockchain_events).toBe(2);
      expect(activity.failed_blockchain_events).toBe(1);
    });

    it('should handle missing blockchain logs', async () => {
      const mockReminders = { count: 10 };
      const mockProcessed = { count: 100 };

      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue(mockReminders),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockResolvedValue(mockProcessed),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          then: jest.fn().mockImplementation(function (resolve) {
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }),
        });

      const activity = await monitoringService.getAgentActivity();

      expect(activity.confirmed_blockchain_events).toBe(0);
      expect(activity.failed_blockchain_events).toBe(0);
    });

    it('should handle zero pending reminders', async () => {
      const mockReminders = { count: 0 };
      const mockProcessed = { count: 500 };
      const mockLogs = [
        { status: 'confirmed' },
        { status: 'failed' },
        { status: 'failed' },
      ];

      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue(mockReminders),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockResolvedValue(mockProcessed),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: mockLogs, error: null }),
        });

      const activity = await monitoringService.getAgentActivity();

      expect(activity.pending_reminders).toBe(0);
      expect(activity.processed_reminders_last_24h).toBe(500);
    });

    it('should handle undefined count values', async () => {
      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ count: undefined }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockResolvedValue({ count: undefined }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          then: jest.fn().mockImplementation(function (resolve) {
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }),
        });

      const activity = await monitoringService.getAgentActivity();

      expect(activity.pending_reminders).toBe(0);
      expect(activity.processed_reminders_last_24h).toBe(0);
    });

    it('should throw error on database failure', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      });

      await expect(monitoringService.getAgentActivity()).rejects.toThrow();
    });

    it('should filter blockchain logs correctly by status', async () => {
      const mockReminders = { count: 5 };
      const mockProcessed = { count: 50 };
      const mockLogs = [
        { status: 'confirmed' },
        { status: 'confirmed' },
        { status: 'confirmed' },
        { status: 'failed' },
        { status: 'pending' }, // ignored
        { status: 'failed' },
      ];

      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue(mockReminders),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockResolvedValue(mockProcessed),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: mockLogs, error: null }),
        });

      const activity = await monitoringService.getAgentActivity();

      expect(activity.confirmed_blockchain_events).toBe(3);
      expect(activity.failed_blockchain_events).toBe(2);
    });

    it('should calculate 24-hour window correctly', async () => {
      const mockReminders = { count: 10 };
      const mockProcessed = { count: 100 };
      const mockLogs: any[] = [];

      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue(mockReminders),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockImplementation((_field, value) => {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const passedDate = new Date(value);
            expect(passedDate.getTime()).toBeLessThanOrEqual(yesterday.getTime() + 1000);
            return Promise.resolve(mockProcessed);
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: mockLogs, error: null }),
        });

      await monitoringService.getAgentActivity();

      expect(supabase.from).toHaveBeenCalled();
    });
  });

  // ── Batch Operations ────────────────────────────────────────────────────────

  describe('Batch Operations', () => {
    it('should retrieve all three core metrics concurrently', async () => {
      const mockSubscriptions = [
        { category: 'entertainment', price: 15.99, status: 'active', billing_cycle: 'monthly' },
      ];
      const mockDeliveries = [{ channel: 'email', status: 'sent' }];
      const mockReminders = { count: 5 };
      const mockProcessed = { count: 50 };
      const mockLogs = [{ status: 'confirmed' }];

      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: mockSubscriptions, error: null }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: mockDeliveries, error: null }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue(mockReminders),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          gte: jest.fn().mockResolvedValue(mockProcessed),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockResolvedValue({ data: mockLogs, error: null }),
        });

      const [subscriptionMetrics, renewalMetrics, agentActivity] = await Promise.all([
        monitoringService.getSubscriptionMetrics(),
        monitoringService.getRenewalMetrics(),
        monitoringService.getAgentActivity(),
      ]);

      expect(subscriptionMetrics.total_subscriptions).toBe(1);
      expect(renewalMetrics.total_delivery_attempts).toBe(1);
      expect(agentActivity.pending_reminders).toBe(5);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────────────

  describe('Edge Cases and Error Handling', () => {
    it('should handle division by zero in rate calculations', async () => {
      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockResolvedValue({ data: [], error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getRenewalMetrics();

      expect(metrics.success_rate).toBe(0);
      expect(metrics.failure_rate).toBe(0);
      expect(isNaN(metrics.success_rate)).toBe(false);
    });

    it('should handle very large numbers in revenue calculation', async () => {
      const mockSubscriptions = [
        { category: 'premium', price: Number.MAX_SAFE_INTEGER, status: 'active', billing_cycle: 'monthly' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: mockSubscriptions, error: null }).then(resolve);
        }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getSubscriptionMetrics();

      expect(metrics.total_monthly_revenue).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER * 2);
    });

    it('should handle negative prices gracefully', async () => {
      const mockSubscriptions = [
        { category: 'refund', price: -10, status: 'active', billing_cycle: 'monthly' },
      ];

      const mockQuery = {
        ...mockChain,
        select: jest.fn().mockResolvedValue({ data: mockSubscriptions, error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const metrics = await monitoringService.getSubscriptionMetrics();

      expect(metrics.total_monthly_revenue).toBe(-10);
    });
  });

  // ── getThroughputMetrics (Issue #99) ────────────────────────────────────────

  describe('getThroughputMetrics()', () => {
    const makeMultiTableMock = (
      reminders: any[],
      deliveries: any[],
      renewals: any[],
      bcEvents: any[],
    ) => {
      const makeQ = (data: any[]) => ({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data, error: null }).then(resolve);
        }),
      });

      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeQ(reminders))
        .mockReturnValueOnce(makeQ(deliveries))
        .mockReturnValueOnce(makeQ(renewals))
        .mockReturnValueOnce(makeQ(bcEvents));
    };

    it('should count items processed across all pipelines in the window', async () => {
      makeMultiTableMock(
        [{ status: 'sent' }, { status: 'failed' }],
        [{ channel: 'email', status: 'sent' }, { channel: 'push', status: 'sent' }, { channel: 'email', status: 'failed' }],
        [{ status: 'success' }, { status: 'failed' }],
        [{ status: 'confirmed' }],
      );

      const metrics = await monitoringService.getThroughputMetrics(24);

      expect(metrics.window_hours).toBe(24);
      expect(metrics.reminders_processed).toBe(2);
      expect(metrics.notification_deliveries_total).toBe(3);
      expect(metrics.renewals_executed).toBe(2);
      expect(metrics.blockchain_events).toBe(1);
    });

    it('should aggregate deliveries_by_channel correctly', async () => {
      makeMultiTableMock(
        [],
        [
          { channel: 'email', status: 'sent' },
          { channel: 'email', status: 'sent' },
          { channel: 'email', status: 'failed' },
          { channel: 'telegram', status: 'sent' },
          { channel: 'push', status: 'failed' },
        ],
        [],
        [],
      );

      const metrics = await monitoringService.getThroughputMetrics();

      expect(metrics.deliveries_by_channel['email']).toBe(3);
      expect(metrics.deliveries_by_channel['telegram']).toBe(1);
      expect(metrics.deliveries_by_channel['push']).toBe(1);
    });

    it('should aggregate renewals_by_status correctly', async () => {
      makeMultiTableMock(
        [],
        [],
        [
          { status: 'success' },
          { status: 'success' },
          { status: 'failed' },
        ],
        [],
      );

      const metrics = await monitoringService.getThroughputMetrics();

      expect(metrics.renewals_by_status['success']).toBe(2);
      expect(metrics.renewals_by_status['failed']).toBe(1);
    });

    it('should return zeroes for an empty window', async () => {
      makeMultiTableMock([], [], [], []);

      const metrics = await monitoringService.getThroughputMetrics(1);

      expect(metrics.reminders_processed).toBe(0);
      expect(metrics.notification_deliveries_total).toBe(0);
      expect(metrics.renewals_executed).toBe(0);
      expect(metrics.blockchain_events).toBe(0);
      expect(Object.keys(metrics.deliveries_by_channel)).toHaveLength(0);
    });

    it('should include window_start in ISO-8601 format', async () => {
      makeMultiTableMock([], [], [], []);

      const before = Date.now();
      const metrics = await monitoringService.getThroughputMetrics(48);
      const after = Date.now();

      const windowStartMs = new Date(metrics.window_start).getTime();
      expect(windowStartMs).toBeLessThanOrEqual(before - 48 * 60 * 60 * 1000 + 1000);
      expect(windowStartMs).toBeGreaterThanOrEqual(after - 48 * 60 * 60 * 1000 - 1000);
    });

    it('should throw on reminder_schedules DB error', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: null, error: new Error('DB error') }).then(resolve);
        }),
      }).mockReturnValue(mockChain);

      await expect(monitoringService.getThroughputMetrics()).rejects.toThrow('DB error');
    });
  });

  // ── getLatencyMetrics (Issue #99) ───────────────────────────────────────────

  describe('getLatencyMetrics()', () => {
    const makeLatencyMock = (deliveries: any[], renewals: any[]) => {
      const makeQ = (data: any[]) => ({
        select: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data, error: null }).then(resolve);
        }),
      });

      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeQ(deliveries))
        .mockReturnValueOnce(makeQ(renewals));
    };

    const ts = (offsetMs: number) =>
      new Date(Date.now() - offsetMs).toISOString();

    it('should compute correct p50 / p95 / p99 for notification deliveries', async () => {
      // 100 ms, 200 ms, 300 ms, 400 ms, 500 ms, 5000 ms (outlier)
      const now = Date.now();
      const deliveries = [100, 200, 300, 400, 500, 5000].map((ms) => ({
        created_at: new Date(now - ms).toISOString(),
        last_attempt_at: new Date(now).toISOString(),
      }));

      makeLatencyMock(deliveries, []);

      const metrics = await monitoringService.getLatencyMetrics();

      expect(metrics.notification_delivery_latency.sample_count).toBe(6);
      expect(metrics.notification_delivery_latency.p50_ms).toBeGreaterThanOrEqual(100);
      expect(metrics.notification_delivery_latency.p95_ms).toBeGreaterThanOrEqual(500);
      expect(metrics.notification_delivery_latency.p99_ms).toBeGreaterThanOrEqual(500);
    });

    it('should compute correct latency for renewal pipeline', async () => {
      const now = Date.now();
      const renewals = [1000, 2000, 3000].map((ms) => ({
        created_at: new Date(now - ms).toISOString(),
        updated_at: new Date(now).toISOString(),
      }));

      makeLatencyMock([], renewals);

      const metrics = await monitoringService.getLatencyMetrics();

      expect(metrics.renewal_execution_latency.sample_count).toBe(3);
      expect(metrics.renewal_execution_latency.avg_ms).toBeGreaterThan(0);
    });

    it('should return zero percentiles when no data exists', async () => {
      makeLatencyMock([], []);

      const metrics = await monitoringService.getLatencyMetrics();

      expect(metrics.notification_delivery_latency.sample_count).toBe(0);
      expect(metrics.notification_delivery_latency.p50_ms).toBe(0);
      expect(metrics.renewal_execution_latency.sample_count).toBe(0);
      expect(metrics.renewal_execution_latency.p50_ms).toBe(0);
    });

    it('should handle a single sample', async () => {
      const now = Date.now();
      const deliveries = [{ created_at: new Date(now - 500).toISOString(), last_attempt_at: new Date(now).toISOString() }];

      makeLatencyMock(deliveries, []);

      const metrics = await monitoringService.getLatencyMetrics();

      const p = metrics.notification_delivery_latency;
      expect(p.sample_count).toBe(1);
      expect(p.p50_ms).toBe(p.p95_ms);
      expect(p.p95_ms).toBe(p.p99_ms);
    });

    it('should throw on DB error in delivery query', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        not: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: null, error: new Error('latency DB error') }).then(resolve);
        }),
      }).mockReturnValue(mockChain);

      await expect(monitoringService.getLatencyMetrics()).rejects.toThrow('latency DB error');
    });
  });

  // ── getRetryMetrics (Issue #99) ─────────────────────────────────────────────

  describe('getRetryMetrics()', () => {
    const makeRetryMock = (rows: any[]) => {
      (supabase.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        }),
      });
    };

    it('should count retried deliveries (attempt_count > 1)', async () => {
      makeRetryMock([
        { channel: 'email', status: 'sent', attempt_count: 1 },
        { channel: 'email', status: 'sent', attempt_count: 2 },
        { channel: 'email', status: 'failed', attempt_count: 3 },
        { channel: 'push', status: 'failed', attempt_count: 1 },
      ]);

      const metrics = await monitoringService.getRetryMetrics();

      expect(metrics.total_retried).toBe(2); // attempt_count 2 and 3
    });

    it('should count max_retries_hit (attempt_count >= maxRetryAttempts)', async () => {
      makeRetryMock([
        { channel: 'email', status: 'failed', attempt_count: 3 },
        { channel: 'email', status: 'failed', attempt_count: 3 },
        { channel: 'email', status: 'failed', attempt_count: 2 },
      ]);

      const metrics = await monitoringService.getRetryMetrics(24, 3);

      expect(metrics.max_retries_hit).toBe(2);
    });

    it('should build attempt_distribution correctly', async () => {
      makeRetryMock([
        { channel: 'email', status: 'sent', attempt_count: 1 },
        { channel: 'email', status: 'sent', attempt_count: 1 },
        { channel: 'email', status: 'failed', attempt_count: 2 },
        { channel: 'email', status: 'failed', attempt_count: 3 },
      ]);

      const metrics = await monitoringService.getRetryMetrics();

      expect(metrics.attempt_distribution[1]).toBe(2);
      expect(metrics.attempt_distribution[2]).toBe(1);
      expect(metrics.attempt_distribution[3]).toBe(1);
    });

    it('should break down retries_by_channel correctly', async () => {
      makeRetryMock([
        { channel: 'email', status: 'failed', attempt_count: 2 },
        { channel: 'email', status: 'failed', attempt_count: 3 },
        { channel: 'push', status: 'failed', attempt_count: 3 },
      ]);

      const metrics = await monitoringService.getRetryMetrics(24, 3);

      expect(metrics.retries_by_channel['email'].retried).toBe(2);
      expect(metrics.retries_by_channel['email'].max_hit).toBe(1);
      expect(metrics.retries_by_channel['push'].retried).toBe(1);
      expect(metrics.retries_by_channel['push'].max_hit).toBe(1);
    });

    it('should return zero retry_rate_pct when no failures', async () => {
      makeRetryMock([
        { channel: 'email', status: 'sent', attempt_count: 1 },
      ]);

      const metrics = await monitoringService.getRetryMetrics();

      expect(metrics.retry_rate_pct).toBe(0);
    });

    it('should return zeroes for empty window', async () => {
      makeRetryMock([]);

      const metrics = await monitoringService.getRetryMetrics();

      expect(metrics.total_retried).toBe(0);
      expect(metrics.max_retries_hit).toBe(0);
      expect(metrics.retry_rate_pct).toBe(0);
      expect(Object.keys(metrics.attempt_distribution)).toHaveLength(0);
    });

    it('should throw on DB error', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: null, error: new Error('retry DB error') }).then(resolve);
        }),
      }).mockReturnValue(mockChain);

      await expect(monitoringService.getRetryMetrics()).rejects.toThrow('retry DB error');
    });
  });

  // ── getFailedItems (Issue #99) ──────────────────────────────────────────────

  describe('getFailedItems()', () => {
    const makeFailedItemsMock = (data: any[], count: number) => {
      (supabase.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data, error: null, count }).then(resolve);
        }),
      });
    };

    it('should return failed reminder deliveries with correct shape', async () => {
      const rows = [
        {
          id: 'del-1',
          status: 'failed',
          channel: 'email',
          attempt_count: 3,
          error_message: 'SMTP timeout',
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:01:00Z',
          reminder_schedules: { subscription_id: 'sub-1', user_id: 'usr-1' },
        },
      ];
      makeFailedItemsMock(rows, 1);

      const result = await monitoringService.getFailedItems('reminder', 20, 0);

      expect(result.type).toBe('reminder');
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('del-1');
      expect(result.items[0].channel).toBe('email');
      expect(result.items[0].error_message).toBe('SMTP timeout');
      expect(result.items[0].subscription_id).toBe('sub-1');
    });

    it('should return failed renewal logs with correct shape', async () => {
      const rows = [
        {
          id: 'rnw-1',
          status: 'failed',
          failure_reason: 'contract_failure',
          error_message: 'Soroban timeout',
          subscription_id: 'sub-2',
          user_id: 'usr-2',
          created_at: '2026-05-02T00:00:00Z',
          updated_at: '2026-05-02T00:00:05Z',
        },
      ];
      makeFailedItemsMock(rows, 1);

      const result = await monitoringService.getFailedItems('renewal', 20, 0);

      expect(result.type).toBe('renewal');
      expect(result.items[0].failure_reason).toBe('contract_failure');
      expect(result.items[0].subscription_id).toBe('sub-2');
    });

    it('should return failed blockchain events with correct shape', async () => {
      const rows = [
        {
          id: 'bc-1',
          status: 'failed',
          error_message: 'Network error',
          subscription_id: 'sub-3',
          user_id: 'usr-3',
          created_at: '2026-05-03T00:00:00Z',
        },
      ];
      makeFailedItemsMock(rows, 1);

      const result = await monitoringService.getFailedItems('blockchain', 20, 0);

      expect(result.type).toBe('blockchain');
      expect(result.items[0].error_message).toBe('Network error');
    });

    it('should respect limit (max 100) and offset', async () => {
      makeFailedItemsMock([], 200);

      const result = await monitoringService.getFailedItems('reminder', 200, 50); // 200 > max=100

      expect(result.limit).toBe(100);
      expect(result.offset).toBe(50);
    });

    it('should return empty items array when no failures exist', async () => {
      makeFailedItemsMock([], 0);

      const result = await monitoringService.getFailedItems('renewal');

      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it('should throw on DB error', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function (resolve) {
          return Promise.resolve({ data: null, error: new Error('failed items DB error'), count: 0 }).then(resolve);
        }),
      }).mockReturnValue(mockChain);

      await expect(monitoringService.getFailedItems('reminder')).rejects.toThrow('failed items DB error');
    });
  });
});
