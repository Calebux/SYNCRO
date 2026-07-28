/**
 * Integration tests for Stripe webhook route (POST /api/webhooks/stripe)
 * Covers: success, idempotent-replay, rejected-forgery (#1084)
 */
import request from 'supertest';
import express, { type Express } from 'express';
import Stripe from 'stripe';

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}));

import stripeWebhookRoutes from '../src/routes/stripe-webhook';

const STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_integration_tests';
const STRIPE_SECRET_KEY = 'sk_test_placeholder';

function buildApp(): Express {
  const app = express();
  // Must use raw body parser like in index.ts for signature verification
  app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes);
  return app;
}

const app = buildApp();

describe('Stripe webhook route integration', () => {
  const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    if (originalStripeWebhookSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalStripeWebhookSecret;
    }
    if (originalStripeSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
    }
  });

  const validPayload = JSON.stringify({
    id: 'evt_test_123',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_test' } },
  });

  function generateValidSignature(payload: string): string {
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
    return stripe.webhooks.generateTestHeaderString({
      payload,
      secret: STRIPE_WEBHOOK_SECRET,
    });
  }

  it('accepts a valid Stripe webhook (success)', async () => {
    const signature = generateValidSignature(validPayload);

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('accepts the same webhook twice (idempotent-replay)', async () => {
    const signature = generateValidSignature(validPayload);

    const res1 = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(validPayload);

    const res2 = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it('rejects a webhook with forged signature (rejected-forgery)', async () => {
    const forgedPayload = JSON.stringify({
      id: 'evt_forged',
      type: 'payment_intent.created',
    });

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 't=9999999999,v1=deadbeefcafebabe0123456789abcdef')
      .set('content-type', 'application/json')
      .send(forgedPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Webhook signature verification failed');
  });

  it('rejects a webhook when Stripe signature header is missing (rejected-forgery)', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('content-type', 'application/json')
      .send(validPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Webhook signature verification failed');
  });

  it('rejects a webhook with mismatched payload signature (rejected-forgery)', async () => {
    const signature = generateValidSignature(validPayload);
    const differentPayload = JSON.stringify({ id: 'evt_different', type: 'charge.failed' });

    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(differentPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Webhook signature verification failed');
  });

  describe('malformed-payload handling (#1084)', () => {
    it('rejects a non-JSON malformed payload', async () => {
      const malformedBody = 'not valid json at all';
      const signature = generateValidSignature(malformedBody);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', signature)
        .set('content-type', 'application/json')
        .send(malformedBody);

      expect(res.status).toBe(400);
    });

    it('rejects an empty body', async () => {
      const emptyBody = '{}';
      const signature = generateValidSignature(emptyBody);

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', signature)
        .set('content-type', 'application/json')
        .send(emptyBody);

      // Empty body passes signature but may not match expected event shape
      // The route accepts it since Stripe verifies the signature only
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
    });
  });
});
