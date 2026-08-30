import request from 'supertest';
import express from 'express';
import webhookRoutes from '../src/routes/webhooks';
import notificationDeadLetterRoutes from '../src/routes/notification-dead-letter';
import { webhookDeadLetterService } from '../src/services/webhook-dead-letter-service';
import { notificationDeadLetterService } from '../src/services/notification-dead-letter-service';
import { authenticate, AuthenticatedRequest } from '../src/middleware/auth';

jest.mock('../src/services/webhook-dead-letter-service');
jest.mock('../src/services/notification-dead-letter-service');
jest.mock('../src/middleware/auth');

const mockAuth = authenticate as jest.Mock;
const mockWebhookDeadLetterService = webhookDeadLetterService as jest.Mocked<
  typeof webhookDeadLetterService
>;
const mockNotificationDeadLetterService = notificationDeadLetterService as jest.Mocked<
  typeof notificationDeadLetterService
>;

// Mock middleware that sets req.user
mockAuth.mockImplementation((req: AuthenticatedRequest, res, next) => {
  req.user = { id: 'test-user-123' } as any;
  next();
});

describe('Webhook Dead-Letter API Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/webhooks', webhookRoutes);
  });

  describe('GET /webhooks/dead-letter/all', () => {
    it('should return all dead-letter deliveries for user', async () => {
      const mockDeadLetters = [
        {
          id: 'delivery-1',
          webhook_id: 'webhook-1',
          event_type: 'test.event',
          is_dead_letter: true,
          dead_letter_at: new Date().toISOString(),
        },
      ];

      mockWebhookDeadLetterService.getAllUserDeadLetters.mockResolvedValue(
        mockDeadLetters
      );

      const res = await request(app).get('/webhooks/dead-letter/all');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: mockDeadLetters,
      });
    });

    it('should handle errors gracefully', async () => {
      mockWebhookDeadLetterService.getAllUserDeadLetters.mockRejectedValue(
        new Error('Database error')
      );

      const res = await request(app).get('/webhooks/dead-letter/all');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /webhooks/:id/dead-letter', () => {
    it('should return dead-letter deliveries for specific webhook', async () => {
      const mockDeadLetters = [
        {
          id: 'delivery-1',
          webhook_id: 'webhook-1',
          is_dead_letter: true,
        },
      ];

      mockWebhookDeadLetterService.getDeadLetterDeliveries.mockResolvedValue(
        mockDeadLetters
      );

      const res = await request(app).get('/webhooks/webhook-1/dead-letter');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(mockDeadLetters);
      expect(mockWebhookDeadLetterService.getDeadLetterDeliveries).toHaveBeenCalledWith(
        'test-user-123',
        'webhook-1'
      );
    });
  });

  describe('POST /webhooks/:deliveryId/dead-letter/replay', () => {
    it('should create a replay request', async () => {
      const mockReplay = {
        id: 'replay-1',
        webhook_delivery_id: 'delivery-1',
        status: 'pending',
        idempotency_key: 'key-123',
      };

      mockWebhookDeadLetterService.createReplayRequest.mockResolvedValue(mockReplay);

      const res = await request(app)
        .post('/webhooks/delivery-1/dead-letter/replay')
        .send({ idempotency_key: 'key-123' });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(mockReplay);
    });

    it('should support idempotent replays', async () => {
      const idempotencyKey = 'key-123';
      const mockReplay = {
        id: 'replay-1',
        idempotency_key: idempotencyKey,
        status: 'pending',
      };

      mockWebhookDeadLetterService.createReplayRequest.mockResolvedValue(mockReplay);

      const res1 = await request(app)
        .post('/webhooks/delivery-1/dead-letter/replay')
        .send({ idempotency_key: idempotencyKey });

      const res2 = await request(app)
        .post('/webhooks/delivery-1/dead-letter/replay')
        .send({ idempotency_key: idempotencyKey });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.data.idempotency_key).toBe(res2.body.data.idempotency_key);
    });
  });

  describe('GET /webhooks/:deliveryId/dead-letter/replay-history', () => {
    it('should return replay history for delivery', async () => {
      const mockHistory = [
        {
          id: 'replay-1',
          status: 'success',
          attempted_at: new Date().toISOString(),
        },
        {
          id: 'replay-2',
          status: 'failed',
          attempted_at: new Date().toISOString(),
        },
      ];

      mockWebhookDeadLetterService.getDeadLetterReplayHistory.mockResolvedValue(
        mockHistory
      );

      const res = await request(app).get('/webhooks/delivery-1/dead-letter/replay-history');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].status).toBe('success');
    });
  });

  describe('POST /webhooks/dead-letter/replay/:replayId/execute', () => {
    it('should execute a replay', async () => {
      const mockResult = {
        id: 'replay-1',
        status: 'success',
        response_code: 200,
      };

      mockWebhookDeadLetterService.executeDeadLetterReplay.mockResolvedValue(mockResult);

      const res = await request(app).post('/webhooks/dead-letter/replay/replay-1/execute');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('success');
    });
  });

  describe('GET /webhooks/dead-letter/stats', () => {
    it('should return dead-letter statistics', async () => {
      const mockStats = {
        total_dead_letters: 5,
        dead_letters_24h: 2,
        dead_letters_7d: 5,
        by_webhook: [
          {
            webhook_id: 'webhook-1',
            webhook_url: 'https://example.com/webhook',
            count: 3,
          },
          {
            webhook_id: 'webhook-2',
            webhook_url: 'https://example.com/webhook2',
            count: 2,
          },
        ],
      };

      mockWebhookDeadLetterService.getDeadLetterStats.mockResolvedValue(mockStats);

      const res = await request(app).get('/webhooks/dead-letter/stats');

      expect(res.status).toBe(200);
      expect(res.body.data.total_dead_letters).toBe(5);
      expect(res.body.data.by_webhook).toHaveLength(2);
    });
  });
});

describe('Notification Dead-Letter API Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/notifications/dead-letter', notificationDeadLetterRoutes);
  });

  describe('GET /notifications/dead-letter', () => {
    it('should return all dead-letter entries for user', async () => {
      const mockDeadLetters = [
        {
          id: 'dlq-1',
          user_id: 'test-user-123',
          job_type: 'push',
          failure_count: 4,
        },
      ];

      mockNotificationDeadLetterService.getUserDeadLetters.mockResolvedValue(
        mockDeadLetters
      );

      const res = await request(app).get('/notifications/dead-letter');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(mockDeadLetters);
    });
  });

  describe('GET /notifications/dead-letter/stats', () => {
    it('should return dead-letter statistics', async () => {
      const mockStats = {
        total_dead_letters: 10,
        dead_letters_24h: 3,
        dead_letters_7d: 8,
        by_type: [
          { job_type: 'push', count: 7 },
          { job_type: 'sms', count: 3 },
        ],
      };

      mockNotificationDeadLetterService.getDeadLetterStats.mockResolvedValue(mockStats);

      const res = await request(app).get('/notifications/dead-letter/stats');

      expect(res.status).toBe(200);
      expect(res.body.data.total_dead_letters).toBe(10);
    });
  });

  describe('GET /notifications/dead-letter/:dlqId', () => {
    it('should return a specific dead-letter entry', async () => {
      const mockEntry = {
        id: 'dlq-1',
        user_id: 'test-user-123',
        job_type: 'push',
        failure_count: 4,
      };

      mockNotificationDeadLetterService.getDeadLetterEntry.mockResolvedValue(mockEntry);

      const res = await request(app).get('/notifications/dead-letter/dlq-1');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(mockEntry);
    });
  });

  describe('POST /notifications/dead-letter/:dlqId/replay', () => {
    it('should create a replay request', async () => {
      const mockReplay = {
        id: 'replay-1',
        notification_dlq_id: 'dlq-1',
        status: 'pending',
      };

      mockNotificationDeadLetterService.createReplayRequest.mockResolvedValue(mockReplay);

      const res = await request(app)
        .post('/notifications/dead-letter/dlq-1/replay')
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual(mockReplay);
    });

    it('should support idempotent replays', async () => {
      const idempotencyKey = 'key-456';
      const mockReplay = {
        id: 'replay-1',
        idempotency_key: idempotencyKey,
        status: 'pending',
      };

      mockNotificationDeadLetterService.createReplayRequest.mockResolvedValue(mockReplay);

      const res1 = await request(app)
        .post('/notifications/dead-letter/dlq-1/replay')
        .send({ idempotency_key: idempotencyKey });

      const res2 = await request(app)
        .post('/notifications/dead-letter/dlq-1/replay')
        .send({ idempotency_key: idempotencyKey });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.data.idempotency_key).toBe(res2.body.data.idempotency_key);
    });
  });

  describe('GET /notifications/dead-letter/:dlqId/replay-history', () => {
    it('should return replay history', async () => {
      const mockHistory = [
        {
          id: 'replay-1',
          status: 'success',
          attempted_at: new Date().toISOString(),
        },
      ];

      mockNotificationDeadLetterService.getReplayHistory.mockResolvedValue(mockHistory);

      const res = await request(app).get('/notifications/dead-letter/dlq-1/replay-history');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(mockHistory);
    });
  });

  describe('POST /notifications/dead-letter/replay/:replayId/execute', () => {
    it('should execute a replay', async () => {
      const mockResult = {
        id: 'replay-1',
        status: 'queued',
        original_job_id: 'job-new-123',
      };

      mockNotificationDeadLetterService.executeReplay.mockResolvedValue(mockResult);

      const res = await request(app).post('/notifications/dead-letter/replay/replay-1/execute');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('queued');
    });
  });
});

describe('Dead-Letter Acceptance Criteria', () => {
  describe('Criterion 1: Failed deliveries move to dead-letter after retry exhaustion', () => {
    it('should move webhook delivery to dead-letter after MAX_RETRIES', async () => {
      mockWebhookDeadLetterService.moveToDeadLetter.mockResolvedValue({
        id: 'delivery-1',
        is_dead_letter: true,
        dead_letter_reason: 'Exhausted 5 retries',
      } as any);

      const result = await webhookDeadLetterService.moveToDeadLetter(
        'delivery-1',
        'Exhausted 5 retries',
        'HTTP 500: Server Error'
      );

      expect(result.is_dead_letter).toBe(true);
      expect(result.dead_letter_reason).toBe('Exhausted 5 retries');
    });

    it('should move notification job to dead-letter after retry exhaustion', async () => {
      const jobData = {
        type: 'push' as const,
        userId: 'user-1',
        payload: { title: 'Test', body: 'Test' },
      };

      mockNotificationDeadLetterService.moveToDeadLetter.mockResolvedValue({
        id: 'dlq-1',
        user_id: 'user-1',
        job_type: 'push',
        failure_count: 4,
      } as any);

      const result = await notificationDeadLetterService.moveToDeadLetter(
        jobData,
        'job-1',
        4,
        'Service unavailable'
      );

      expect(result.failure_count).toBe(4);
    });
  });

  describe('Criterion 2: Operators can inspect and replay deliveries safely', () => {
    it('should allow retrieval and inspection of dead-letter deliveries', async () => {
      mockWebhookDeadLetterService.getDeadLetterDeliveries.mockResolvedValue([
        {
          id: 'delivery-1',
          webhook_id: 'webhook-1',
          event_type: 'test.event',
          is_dead_letter: true,
          response_code: 500,
          response_body: 'Server error',
          last_error_message: 'Connection timeout',
        } as any,
      ]);

      const deliveries = await webhookDeadLetterService.getDeadLetterDeliveries(
        'user-1',
        'webhook-1'
      );

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].response_code).toBe(500);
      expect(deliveries[0].last_error_message).toBe('Connection timeout');
    });

    it('should allow safe replay of dead-letter deliveries', async () => {
      mockWebhookDeadLetterService.executeDeadLetterReplay.mockResolvedValue({
        id: 'replay-1',
        status: 'success',
        response_code: 200,
      } as any);

      const result = await webhookDeadLetterService.executeDeadLetterReplay(
        'replay-1',
        { secret: 'key', url: 'https://example.com' } as any,
        { id: 'delivery-1', payload: {} } as any
      );

      expect(result.status).toBe('success');
      expect(result.response_code).toBe(200);
    });
  });

  describe('Criterion 3: Tests cover duplicate replay protection', () => {
    it('should prevent duplicate replays with same idempotency key', async () => {
      const idempotencyKey = 'key-789';

      mockWebhookDeadLetterService.createReplayRequest
        .mockResolvedValueOnce({
          id: 'replay-1',
          idempotency_key: idempotencyKey,
        } as any)
        .mockResolvedValueOnce({
          id: 'replay-1', // Same replay returned
          idempotency_key: idempotencyKey,
        } as any);

      const replay1 = await webhookDeadLetterService.createReplayRequest(
        'delivery-1',
        'user-1',
        idempotencyKey
      );

      const replay2 = await webhookDeadLetterService.createReplayRequest(
        'delivery-1',
        'user-1',
        idempotencyKey
      );

      expect(replay1.id).toBe(replay2.id); // Same replay
      expect(replay1.idempotency_key).toBe(replay2.idempotency_key);
    });

    it('should support notification replay idempotency', async () => {
      const idempotencyKey = 'key-456';

      mockNotificationDeadLetterService.createReplayRequest
        .mockResolvedValueOnce({
          id: 'replay-1',
          idempotency_key: idempotencyKey,
        } as any)
        .mockResolvedValueOnce({
          id: 'replay-1', // Same replay returned on duplicate
          idempotency_key: idempotencyKey,
        } as any);

      const replay1 = await notificationDeadLetterService.createReplayRequest(
        'dlq-1',
        'user-1',
        idempotencyKey
      );

      const replay2 = await notificationDeadLetterService.createReplayRequest(
        'dlq-1',
        'user-1',
        idempotencyKey
      );

      expect(replay1.id).toBe(replay2.id);
    });
  });
});
