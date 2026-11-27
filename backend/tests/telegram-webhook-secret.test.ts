/**
 * Tests for Telegram webhook secret-token validation middleware (#477)
 */

import request from 'supertest';
import express, { type Express } from 'express';

jest.mock('../src/config/database', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
      }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
  trackDbRequest: () => () => {},
}));

jest.mock('../src/services/telegram-bot-service', () => ({
  telegramBotService: {
    isConfigured: () => false,
    sendSimpleMessage: jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Import after mocks are set up
import telegramWebhookRoutes from '../src/routes/telegram-webhook';

const minimalUpdate = { update_id: 1 };

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/telegram', telegramWebhookRoutes);
  return app;
}

const app = buildApp();

describe('Telegram webhook secret validation', () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
    } else {
      process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
    }
  });

  it('returns 403 when secret is configured and header is missing', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'my-secret';
    const res = await request(app).post('/api/telegram/webhook').send(minimalUpdate);
    expect(res.status).toBe(403);
  });

  it('returns 403 when secret is configured and header is wrong', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'my-secret';
    const res = await request(app)
      .post('/api/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'wrong-secret')
      .send(minimalUpdate);
    expect(res.status).toBe(403);
  });

  it('returns 200 when secret is configured and header matches', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'my-secret';
    const res = await request(app)
      .post('/api/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'my-secret')
      .send(minimalUpdate);
    expect(res.status).toBe(200);
  });

  it('returns 200 when no secret is configured (dev mode)', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await request(app).post('/api/telegram/webhook').send(minimalUpdate);
    expect(res.status).toBe(200);
  });

  it('GET /webhook health check is always accessible', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'my-secret';
    const res = await request(app).get('/api/telegram/webhook');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  describe('Success and idempotent-replay (#1084)', () => {
    beforeEach(() => {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
    });

    it('processes a valid /help command update (success)', async () => {
      const helpUpdate = {
        update_id: 12345,
        message: {
          message_id: 1,
          from: { id: 111, is_bot: false, first_name: 'TestUser' },
          chat: { id: 111, first_name: 'TestUser', type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: '/help',
        },
      };

      const res = await request(app)
        .post('/api/telegram/webhook')
        .send(helpUpdate);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('processes a /start command without deep link (success)', async () => {
      const startUpdate = {
        update_id: 12346,
        message: {
          message_id: 2,
          from: { id: 222, is_bot: false, first_name: 'NewUser' },
          chat: { id: 222, first_name: 'NewUser', type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: '/start',
        },
      };

      const res = await request(app)
        .post('/api/telegram/webhook')
        .send(startUpdate);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('accepts the same update_id twice (idempotent-replay)', async () => {
      const statusUpdate = {
        update_id: 99999,
        message: {
          message_id: 10,
          from: { id: 333, is_bot: false, first_name: 'ReplayUser' },
          chat: { id: 333, first_name: 'ReplayUser', type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: '/help',
        },
      };

      const res1 = await request(app)
        .post('/api/telegram/webhook')
        .send(statusUpdate);

      const res2 = await request(app)
        .post('/api/telegram/webhook')
        .send(statusUpdate);

      expect(res1.status).toBe(200);
      expect(res1.body).toEqual({ ok: true });
      expect(res2.status).toBe(200);
      expect(res2.body).toEqual({ ok: true });
    });
  });
});
