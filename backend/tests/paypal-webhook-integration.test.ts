/**
 * Integration tests for PayPal webhook route (POST /api/webhooks/paypal)
 * Covers: success, idempotent-replay, rejected-forgery (#1084)
 */
import request from 'supertest';
import express, { type Express } from 'express';

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}));

import paypalWebhookRoutes from '../src/routes/paypal-webhook';

function buildApp(): Express {
  const app = express();
  app.use('/api/webhooks/paypal', express.raw({ type: 'application/json' }), paypalWebhookRoutes);
  return app;
}

const app = buildApp();

describe('PayPal webhook route integration', () => {
  const originalEnv: Record<string, string | undefined> = {};
  const PAYPAL_WEBHOOK_ID = 'WH-TEST-12345';
  const PAYPAL_CLIENT_ID = 'test_client_id';
  const PAYPAL_CLIENT_SECRET = 'test_client_secret';

  const originalFetch = global.fetch;

  beforeEach(() => {
    originalEnv.PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
    originalEnv.PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
    originalEnv.PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
    originalEnv.PAYPAL_MODE = process.env.PAYPAL_MODE;

    process.env.PAYPAL_WEBHOOK_ID = PAYPAL_WEBHOOK_ID;
    process.env.PAYPAL_CLIENT_ID = PAYPAL_CLIENT_ID;
    process.env.PAYPAL_CLIENT_SECRET = PAYPAL_CLIENT_SECRET;
    process.env.PAYPAL_MODE = 'sandbox';
  });

  afterEach(() => {
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    global.fetch = originalFetch;
  });

  const validPayload = JSON.stringify({
    id: 'WH-58D07950BU892453L',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { id: 'CAP-123', amount: { total: '29.99', currency: 'USD' } },
  });

  const validHeaders = {
    'paypal-transmission-id': 'tx-abc-123',
    'paypal-transmission-time': '2026-07-01T12:00:00Z',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-ID',
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-transmission-sig': 'mock-signature-value',
  };

  function mockPayPalSuccess() {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test_access_token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verification_status: 'SUCCESS' }),
      }) as jest.Mock;
  }

  function mockPayPalFailure() {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test_access_token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verification_status: 'FAILURE' }),
      }) as jest.Mock;
  }

  it('accepts a valid PayPal webhook (success)', async () => {
    mockPayPalSuccess();

    const res = await request(app)
      .post('/api/webhooks/paypal')
      .set(validHeaders)
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('accepts the same webhook twice (idempotent-replay)', async () => {
    // Use a single mock that returns success for all fetch calls
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test_access_token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verification_status: 'SUCCESS' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test_access_token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ verification_status: 'SUCCESS' }),
      }) as jest.Mock;

    const res1 = await request(app)
      .post('/api/webhooks/paypal')
      .set(validHeaders)
      .set('content-type', 'application/json')
      .send(validPayload);

    const res2 = await request(app)
      .post('/api/webhooks/paypal')
      .set(validHeaders)
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it('rejects a webhook with PayPal verification FAILURE (rejected-forgery)', async () => {
    mockPayPalFailure();

    const res = await request(app)
      .post('/api/webhooks/paypal')
      .set(validHeaders)
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('rejects a webhook when transmission headers are missing (rejected-forgery)', async () => {
    const res = await request(app)
      .post('/api/webhooks/paypal')
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('rejects a webhook when some transmission headers are missing (rejected-forgery)', async () => {
    const res = await request(app)
      .post('/api/webhooks/paypal')
      .set('paypal-transmission-id', 'tx-partial')
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res.status).toBe(401);
  });

  describe('malformed-payload handling (#1084)', () => {
    it('rejects a non-JSON malformed payload', async () => {
      const res = await request(app)
        .post('/api/webhooks/paypal')
        .set(validHeaders)
        .set('content-type', 'application/json')
        .send('not valid json');

      expect(res.status).toBe(401);
    });

    it('rejects an empty body', async () => {
      const res = await request(app)
        .post('/api/webhooks/paypal')
        .set(validHeaders)
        .set('content-type', 'application/json')
        .send('');

      expect(res.status).toBe(401);
    });
  });
});
