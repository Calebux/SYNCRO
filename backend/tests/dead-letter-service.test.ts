import { webhookDeadLetterService } from '../src/services/webhook-dead-letter-service';
import { notificationDeadLetterService } from '../src/services/notification-dead-letter-service';
import { webhookService } from '../src/services/webhook-service';
import { supabase } from '../src/config/database';
import logger from '../src/config/logger';
import crypto from 'crypto';

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

describe('Webhook Dead-Letter Service', () => {
  const userId = 'test-user-123';
  const webhookId = 'webhook-123';
  const deliveryId = 'delivery-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('moveToDeadLetter', () => {
    it('should move a failed delivery to dead-letter state', async () => {
      const mockUpdate = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: {
          id: deliveryId,
          webhook_id: webhookId,
          is_dead_letter: true,
          dead_letter_at: new Date().toISOString(),
          status: 'failed',
        },
        error: null,
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockEq.mockReturnValue({ select: mockSelect });
      mockUpdate.mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      const result = await webhookDeadLetterService.moveToDeadLetter(
        deliveryId,
        'Exhausted 5 retries',
        'HTTP 500: Internal Server Error'
      );

      expect(supabase.from).toHaveBeenCalledWith('webhook_deliveries');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          is_dead_letter: true,
          dead_letter_reason: 'Exhausted 5 retries',
          last_error_message: 'HTTP 500: Internal Server Error',
        })
      );
      expect(result.is_dead_letter).toBe(true);
    });

    it('should log a warning when moving to dead-letter', async () => {
      const mockUpdate = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: { id: deliveryId },
        error: null,
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockEq.mockReturnValue({ select: mockSelect });
      mockUpdate.mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      await webhookDeadLetterService.moveToDeadLetter(deliveryId, 'Test reason', 'Test error');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`${deliveryId} moved to dead-letter`)
      );
    });
  });

  describe('getDeadLetterDeliveries', () => {
    it('should retrieve dead-letter deliveries for a webhook', async () => {
      const mockDeliveries = [
        {
          id: deliveryId,
          webhook_id: webhookId,
          is_dead_letter: true,
          status: 'failed',
        },
      ];

      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockOrder = jest.fn().mockResolvedValue({
        data: mockDeliveries,
        error: null,
      });

      mockEq.mockReturnValue({ order: mockOrder });
      mockSelect.mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: { id: webhookId },
                error: null,
              }),
            }),
          }),
        })
        .mockReturnValueOnce({ select: mockSelect });

      const result = await webhookDeadLetterService.getDeadLetterDeliveries(userId, webhookId);

      expect(result).toEqual(mockDeliveries);
    });

    it('should throw error if webhook not found', async () => {
      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      });

      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      await expect(
        webhookDeadLetterService.getDeadLetterDeliveries(userId, 'unknown-webhook')
      ).rejects.toThrow('Webhook not found or access denied');
    });
  });

  describe('createReplayRequest', () => {
    it('should create a replay request with generated idempotency key', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: {
          id: 'replay-123',
          webhook_delivery_id: deliveryId,
          idempotency_key: expect.any(String),
          status: 'pending',
        },
        error: null,
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });

      // Mock webhook verification
      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: { id: deliveryId, webhooks: { user_id: userId } },
                error: null,
              }),
            }),
          }),
        })
        .mockReturnValueOnce({ insert: mockInsert });

      const result = await webhookDeadLetterService.createReplayRequest(deliveryId, userId);

      expect(result.status).toBe('pending');
      expect(result.idempotency_key).toBeDefined();
    });

    it('should use provided idempotency key', async () => {
      const customIdempotencyKey = crypto.randomUUID();

      const mockInsert = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: {
          id: 'replay-123',
          idempotency_key: customIdempotencyKey,
        },
        error: null,
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });

      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: { id: deliveryId, webhooks: { user_id: userId } },
                error: null,
              }),
            }),
          }),
        })
        .mockReturnValueOnce({ insert: mockInsert });

      const result = await webhookDeadLetterService.createReplayRequest(
        deliveryId,
        userId,
        customIdempotencyKey
      );

      expect(result.idempotency_key).toBe(customIdempotencyKey);
    });

    it('should handle duplicate idempotency keys (duplicate protection)', async () => {
      const idempotencyKey = crypto.randomUUID();

      // First call returns unique constraint error
      const mockInsert = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest
        .fn()
        .mockResolvedValueOnce({
          data: null,
          error: { code: '23505' }, // Unique constraint violation
        })
        .mockResolvedValueOnce({
          data: {
            id: 'replay-123',
            idempotency_key: idempotencyKey,
            status: 'pending',
          },
          error: null,
        });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });

      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: { id: deliveryId, webhooks: { user_id: userId } },
                error: null,
              }),
            }),
          }),
        })
        .mockReturnValueOnce({ insert: mockInsert })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: {
                id: 'replay-123',
                idempotency_key: idempotencyKey,
              },
              error: null,
            }),
          }),
        });

      const result = await webhookDeadLetterService.createReplayRequest(
        deliveryId,
        userId,
        idempotencyKey
      );

      expect(result.idempotency_key).toBe(idempotencyKey);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Idempotent replay')
      );
    });
  });

  describe('executeReplay', () => {
    it('should execute a replay and update status on success', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"success": true}'),
      });

      global.fetch = mockFetch;

      const webhook = {
        id: webhookId,
        secret: 'test-secret',
        url: 'https://example.com/webhook',
      };

      const delivery = {
        id: deliveryId,
        webhook_id: webhookId,
        payload: { test: 'data' },
      };

      const mockUpdate = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: {
          id: 'replay-123',
          status: 'success',
        },
        error: null,
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockEq.mockReturnValue({ select: mockSelect });
      mockUpdate.mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      const result = await webhookDeadLetterService.executeReplay('replay-123', webhook, delivery);

      expect(result.status).toBe('success');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Replay'));
    });

    it('should handle replay failures and update status', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
      });

      global.fetch = mockFetch;

      const webhook = {
        id: webhookId,
        secret: 'test-secret',
        url: 'https://example.com/webhook',
      };

      const delivery = {
        id: deliveryId,
        payload: { test: 'data' },
      };

      const mockUpdate = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: {
          id: 'replay-123',
          status: 'failed',
          error_message: expect.stringContaining('HTTP 500'),
        },
        error: null,
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockEq.mockReturnValue({ select: mockSelect });
      mockUpdate.mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      const result = await webhookDeadLetterService.executeReplay('replay-123', webhook, delivery);

      expect(result.status).toBe('failed');
    });
  });
});

describe('Notification Dead-Letter Service', () => {
  const userId = 'test-user-123';
  const dlqId = 'dlq-123';
  const jobId = 'job-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('moveToDeadLetter', () => {
    it('should move a failed notification job to dead-letter queue', async () => {
      const jobData = {
        type: 'push' as const,
        userId,
        pushSubscription: {
          endpoint: 'https://example.com/push',
          keys: { p256dh: 'key1', auth: 'key2' },
        },
        payload: { title: 'Test', body: 'Test' },
      };

      const mockInsert = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: {
          id: dlqId,
          user_id: userId,
          job_type: 'push',
          original_job_id: jobId,
          failure_count: 4,
        },
        error: null,
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });
      (supabase.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const result = await notificationDeadLetterService.moveToDeadLetter(
        jobData,
        jobId,
        4,
        'Push service unavailable',
        'SERVICE_UNAVAILABLE'
      );

      expect(supabase.from).toHaveBeenCalledWith('notification_dead_letter_queue');
      expect(result.user_id).toBe(userId);
      expect(result.failure_count).toBe(4);
    });

    it('should log a warning when moving to dead-letter', async () => {
      const jobData = {
        type: 'push' as const,
        userId,
        payload: { title: 'Test', body: 'Test' },
      };

      const mockInsert = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: { id: dlqId, user_id: userId },
        error: null,
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });
      (supabase.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      await notificationDeadLetterService.moveToDeadLetter(
        jobData,
        jobId,
        4,
        'Test error'
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`${jobId} moved to dead-letter`)
      );
    });
  });

  describe('createReplayRequest', () => {
    it('should create a replay request for notification', async () => {
      const mockInsert = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest.fn().mockResolvedValue({
        data: {
          id: 'replay-123',
          notification_dlq_id: dlqId,
          status: 'pending',
        },
        error: null,
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });

      // Mock DLQ entry verification
      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: { id: dlqId },
                error: null,
              }),
            }),
          }),
        })
        .mockReturnValueOnce({ insert: mockInsert });

      const result = await notificationDeadLetterService.createReplayRequest(dlqId, userId);

      expect(result.status).toBe('pending');
    });

    it('should handle duplicate idempotency keys for notification', async () => {
      const idempotencyKey = crypto.randomUUID();

      const mockInsert = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();
      const mockSingle = jest
        .fn()
        .mockResolvedValueOnce({
          data: null,
          error: { code: '23505' },
        })
        .mockResolvedValueOnce({
          data: {
            id: 'replay-123',
            idempotency_key: idempotencyKey,
          },
          error: null,
        });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });

      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: { id: dlqId },
                error: null,
              }),
            }),
          }),
        })
        .mockReturnValueOnce({ insert: mockInsert })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: {
                id: 'replay-123',
                idempotency_key: idempotencyKey,
              },
              error: null,
            }),
          }),
        });

      const result = await notificationDeadLetterService.createReplayRequest(
        dlqId,
        userId,
        idempotencyKey
      );

      expect(result.idempotency_key).toBe(idempotencyKey);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Idempotent replay')
      );
    });
  });

  describe('Integration: Failed delivery exhausting retries', () => {
    it('should move delivery to dead-letter after MAX_RETRIES', async () => {
      const mockUpdate = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockSelect = jest.fn().mockReturnThis();

      mockEq.mockReturnValue({ select: mockSelect });
      mockUpdate.mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnThis(),
          }),
        })
        .mockReturnValueOnce({ update: mockUpdate });

      mockSelect.mockResolvedValue({
        data: {
          id: deliveryId,
          is_dead_letter: true,
          dead_letter_at: new Date().toISOString(),
        },
        error: null,
      });

      await webhookDeadLetterService.moveToDeadLetter(
        deliveryId,
        'Exhausted retries',
        'Final failure'
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('dead-letter')
      );
    });
  });
});
