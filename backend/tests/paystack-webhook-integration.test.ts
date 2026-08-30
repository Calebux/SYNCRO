/**
 * Integration tests for the Paystack webhook route (POST /api/webhooks/paystack).
 * Covers: success, idempotent-replay, rejected-forgery (#1084) under the unified
 * ingestion pipeline (#1283).
 *
 * **Behaviour change in #1283.** This route used to call `res.sendStatus(200)`
 * *before* verifying the signature, so a forged delivery was answered 200 and
 * only logged. It now flows through the shared pipeline: verification failure
 * returns 4xx and persists nothing beyond an audit record, and a verified
 * delivery is acknowledged only after it is durably stored.
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

// The in-memory fake enforces the real UNIQUE (provider, event_id) constraint,
// so the duplicate-delivery assertion below tests deduplication for real.
import { FakeSupabase } from './helpers/fake-supabase';

const fakeDb = new FakeSupabase();

jest.mock('../src/config/database', () => ({
  supabase: { from: (table: string) => fakeDb.from(table) },
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
    fakeDb.reset();
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

  function post(payload: string, signature?: string) {
    const req = request(app)
      .post('/api/webhooks/paystack')
      .set('content-type', 'application/json');
    if (signature !== undefined) req.set('x-paystack-signature', signature);
    return req.send(payload);
  }

  it('accepts a valid Paystack webhook (success)', async () => {
    const res = await post(validPayload, generateValidSignature(validPayload));

    // 202: verified and durably stored; the handler runs asynchronously.
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ received: true, eventId: 'ref_test_123' });

    // The transaction reference is the deduplication key, scoped by provider.
    expect(fakeDb.rows('webhook_events')).toHaveLength(1);
    expect(fakeDb.rows('webhook_events')[0]).toMatchObject({
      provider: 'paystack',
      event_id: 'ref_test_123',
      event_type: 'charge.success',
    });
  });

  it('accepts the same webhook twice (idempotent-replay)', async () => {
    const signature = generateValidSignature(validPayload);

    const res1 = await post(validPayload, signature);
    const res2 = await post(validPayload, signature);

    expect(res1.status).toBe(202);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ received: true, duplicate: true, eventId: 'ref_test_123' });

    // The redelivery is not stored a second time.
    expect(fakeDb.rows('webhook_events')).toHaveLength(1);
  });

  it('rejects a forged signature with 4xx and stores no event (rejected-forgery)', async () => {
    const forgedPayload = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'ref_forged', amount: 99999 },
    });

    const res = await post(forgedPayload, 'deadbeef' + '0'.repeat(120));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Webhook signature verification failed' });
    expect(fakeDb.rows('webhook_events')).toHaveLength(0);
  });

  it('records an audit row for a rejected delivery, without the body', async () => {
    const forgedPayload = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'ref_forged', amount: 99999 },
    });

    await post(forgedPayload, 'deadbeef' + '0'.repeat(120));

    const rejections = fakeDb.rows('webhook_rejections');
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toMatchObject({ provider: 'paystack', http_status: 400 });
    // The unverified payload must never be persisted.
    expect(JSON.stringify(rejections[0])).not.toContain('ref_forged');
  });

  it('rejects when the Paystack signature header is missing', async () => {
    const res = await post(validPayload);

    expect(res.status).toBe(400);
    expect(fakeDb.rows('webhook_events')).toHaveLength(0);
  });

  describe('malformed-payload handling (#1084)', () => {
    it('rejects a non-JSON payload that fails verification', async () => {
      const res = await post('not valid json', 'deadbeef' + '0'.repeat(120));

      expect(res.status).toBe(400);
      expect(fakeDb.rows('webhook_events')).toHaveLength(0);
    });

    it('rejects an empty body with no signature', async () => {
      const res = await post('');

      expect(res.status).toBe(400);
      expect(fakeDb.rows('webhook_events')).toHaveLength(0);
    });

    it('rejects a verified payload that carries no transaction reference', async () => {
      // Signed correctly, but with no `data.reference` there is no
      // deduplication key, so the pipeline refuses to store an unkeyed row.
      const noReference = JSON.stringify({ event: 'charge.success', data: { amount: 100 } });

      const res = await post(noReference, generateValidSignature(noReference));

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Webhook payload is missing an event id' });
      expect(fakeDb.rows('webhook_events')).toHaveLength(0);
      expect(fakeDb.rows('webhook_rejections')).toHaveLength(1);
    });
  });
});
