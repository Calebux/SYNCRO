/**
 * Integration tests for Paystack webhook route (POST /api/webhooks/paystack)
 * Covers: success, idempotent-replay, rejected-forgery (#1084)
 *
 * Note: The Paystack route sends res.sendStatus(200) before signature
 * verification, so even forged signatures receive HTTP 200. The forgery
 * test verifies that the warning logger is called with the rejection reason.
 */
import request from 'supertest';
import express, { type Express } from 'express';
import crypto from 'crypto';

const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: mockLogger,
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}));

import paystackWebhookRoutes from '../src/routes/paystack-webhook';

const PAYSTACK_SECRET_KEY = 'sk_test_secret_key_for_integration_testing';

function buildApp(): Express {
  const app = express();
  app.use('/api/webhooks/paystack', express.raw({ type: 'application/json' }), paystackWebhookRoutes);
  return app;
}

const app = buildApp();

describe('Paystack webhook route integration', () => {
  const originalPaystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET_KEY;
    process.env.NODE_ENV = 'production';
    mockLogger.warn.mockClear();
  });

  afterEach(() => {
    if (originalPaystackSecretKey === undefined) {
      delete process.env.PAYSTACK_SECRET_KEY;
    } else {
      process.env.PAYSTACK_SECRET_KEY = originalPaystackSecretKey;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  const validPayload = JSON.stringify({
    event: 'charge.success',
    data: { reference: 'ref_test_123', amount: 5000, status: 'success' },
  });

  function generateValidSignature(payload: string): string {
    return crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(payload).digest('hex');
  }

  it('accepts a valid Paystack webhook (success)', async () => {
    const signature = generateValidSignature(validPayload);

    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('x-paystack-signature', signature)
      .set('content-type', 'application/json')
      .send(validPayload);

    // Paystack route always responds 200 immediately
    expect(res.status).toBe(200);
    // No warning should be logged on valid signature
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      '[PaystackWebhook] Rejected — invalid signature',
      expect.anything(),
    );
  });

  it('accepts the same webhook twice (idempotent-replay)', async () => {
    const signature = generateValidSignature(validPayload);

    const res1 = await request(app)
      .post('/api/webhooks/paystack')
      .set('x-paystack-signature', signature)
      .set('content-type', 'application/json')
      .send(validPayload);

    const res2 = await request(app)
      .post('/api/webhooks/paystack')
      .set('x-paystack-signature', signature)
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it('logs a warning on forged signature (rejected-forgery)', async () => {
    const forgedPayload = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'ref_forged', amount: 99999 },
    });

    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('x-paystack-signature', 'deadbeef' + '0'.repeat(120))
      .set('content-type', 'application/json')
      .send(forgedPayload);

    // Paystack always returns 200 (response sent before verification)
    expect(res.status).toBe(200);
    // But it should log the forgery warning
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[PaystackWebhook] Rejected — invalid signature',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('rejects (logs warning) when Paystack signature header is missing', async () => {
    const res = await request(app)
      .post('/api/webhooks/paystack')
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[PaystackWebhook] Rejected — invalid signature',
      expect.anything(),
    );
  });

  describe('malformed-payload handling (#1084)', () => {
    it('returns 200 for a non-JSON malformed payload (body always accepted)', async () => {
      const res = await request(app)
        .post('/api/webhooks/paystack')
        .set('x-paystack-signature', 'deadbeef' + '0'.repeat(120))
        .set('content-type', 'application/json')
        .send('not valid json');

      // Paystack always responds 200 first, regardless of payload validity
      expect(res.status).toBe(200);
      // Should log the forgery warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[PaystackWebhook] Rejected — invalid signature',
        expect.anything(),
      );
    });

    it('returns 200 for an empty body', async () => {
      const res = await request(app)
        .post('/api/webhooks/paystack')
        .set('content-type', 'application/json')
        .send('');

      expect(res.status).toBe(200);
      // Missing signature should trigger warning in production
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[PaystackWebhook] Rejected — invalid signature',
        expect.anything(),
      );
    });
  });
});
