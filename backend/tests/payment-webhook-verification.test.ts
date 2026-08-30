import crypto from 'crypto';
import Stripe from 'stripe';
import {
  verifyStripeWebhook,
  verifyPaystackWebhook,
  verifyPayPalWebhook,
  verifyTelegramWebhook,
} from '../src/services/payment-webhook-verification';
import { WebhookSignatureAlertService } from '../src/services/webhook-signature-alert-service';

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}));

describe('Payment webhook verification', () => {
  const stripeSecret = 'whsec_test_secret_key_12345';
  const paystackSecret = 'sk_test_paystack_secret';

  describe('verifyStripeWebhook', () => {
    it('should accept a known-good Stripe signature', () => {
      const payload = JSON.stringify({ id: 'evt_test', type: 'payment_intent.succeeded' });
      const stripe = new Stripe('sk_test_placeholder', { apiVersion: '2025-02-24.acacia' });
      const signature = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: stripeSecret,
      });

      const result = verifyStripeWebhook(payload, signature, stripeSecret);
      expect(result.valid).toBe(true);
      expect(result.event).toBeDefined();
    });

    it('should reject a known-bad Stripe signature', () => {
      const payload = JSON.stringify({ id: 'evt_test', type: 'payment_intent.succeeded' });
      const result = verifyStripeWebhook(payload, 't=0,v1=deadbeef', stripeSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject when signature header is missing', () => {
      const result = verifyStripeWebhook('{}', undefined, stripeSecret);
      expect(result.valid).toBe(false);
    });
  });

  describe('verifyPaystackWebhook', () => {
    it('should accept a known-good Paystack HMAC-SHA512 signature', () => {
      const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_123' } });
      const signature = crypto.createHmac('sha512', paystackSecret).update(payload).digest('hex');

      const result = verifyPaystackWebhook(payload, signature, paystackSecret);
      expect(result.valid).toBe(true);
      expect(result.event).toEqual(JSON.parse(payload));
    });

    it('should reject a known-bad Paystack signature', () => {
      const payload = JSON.stringify({ event: 'charge.success' });
      const result = verifyPaystackWebhook(payload, 'a'.repeat(128), paystackSecret);
      expect(result.valid).toBe(false);
    });

    it('should reject when signature header is missing', () => {
      const result = verifyPaystackWebhook('{}', undefined, paystackSecret);
      expect(result.valid).toBe(false);
    });
  });

  describe('verifyPayPalWebhook', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      delete process.env.NODE_ENV;
    });

    it('should accept when PayPal API returns SUCCESS', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ verification_status: 'SUCCESS' }),
        });

      const payload = JSON.stringify({ id: 'WH-123', event_type: 'PAYMENT.CAPTURE.COMPLETED' });
      const result = await verifyPayPalWebhook(
        payload,
        {
          transmissionId: 'tx-1',
          transmissionTime: '2026-01-01T00:00:00Z',
          certUrl: 'https://api.paypal.com/cert',
          authAlgo: 'SHA256withRSA',
          transmissionSig: 'sig',
        },
        { webhookId: 'WH-ID', clientId: 'cid', clientSecret: 'csecret' },
      );

      expect(result.valid).toBe(true);
    });

    it('should reject when PayPal API returns non-SUCCESS', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ verification_status: 'FAILURE' }),
        });

      const payload = JSON.stringify({ id: 'WH-123' });
      const result = await verifyPayPalWebhook(
        payload,
        {
          transmissionId: 'tx-1',
          transmissionTime: '2026-01-01T00:00:00Z',
          certUrl: 'https://api.paypal.com/cert',
          authAlgo: 'SHA256withRSA',
          transmissionSig: 'bad-sig',
        },
        { webhookId: 'WH-ID', clientId: 'cid', clientSecret: 'csecret' },
      );

      expect(result.valid).toBe(false);
    });

    it('should reject when required headers are missing', async () => {
      const result = await verifyPayPalWebhook('{}', {}, { webhookId: 'WH-ID' });
      expect(result.valid).toBe(false);
    });
  });
});

describe('WebhookSignatureAlertService', () => {
  it('should alert after repeated signature failures', () => {
    const service = new WebhookSignatureAlertService();
    const Sentry = require('@sentry/node');

    for (let i = 0; i < 5; i++) {
      service.recordFailure('stripe', { attempt: i });
    }

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Repeated stripe webhook signature failures',
      expect.objectContaining({ level: 'warning' }),
    );
    expect(service.getFailureCount('stripe')).toBe(5);
  });

  it('should reset failure count on success', () => {
    const service = new WebhookSignatureAlertService();
    service.recordFailure('paystack');
    service.recordFailure('paystack');
    service.recordSuccess('paystack');
    expect(service.getFailureCount('paystack')).toBe(0);
  });
});

describe('verifyTelegramWebhook', () => {
  const secret = 'super-secret-telegram-token';
  const payload = JSON.stringify({ update_id: 1, message: { text: '/start' } });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('should accept a correct secret token', () => {
    const result = verifyTelegramWebhook(secret, secret, payload);
    expect(result.valid).toBe(true);
    expect(result.event).toBeDefined();
  });

  it('should reject a forged / wrong secret token', () => {
    const result = verifyTelegramWebhook('forged-token', secret, payload);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/mismatch/i);
  });

  it('should reject when the header is missing', () => {
    const result = verifyTelegramWebhook(undefined, secret, payload);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('should reject in production when secret is not configured', () => {
    process.env.NODE_ENV = 'production';
    const result = verifyTelegramWebhook(secret, undefined, payload);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  it('should allow through in non-production when secret is not configured', () => {
    process.env.NODE_ENV = 'test';
    const result = verifyTelegramWebhook(secret, undefined, payload);
    expect(result.valid).toBe(true);
  });

  it('should reject a token that differs only in length (no timing shortcut)', () => {
    // This proves the padded constant-time path is exercised without panicking.
    const shorterToken = secret.slice(0, -3);
    const result = verifyTelegramWebhook(shorterToken, secret, payload);
    expect(result.valid).toBe(false);
  });

  it('should reject a token that is longer than the secret', () => {
    const longerToken = secret + 'extra';
    const result = verifyTelegramWebhook(longerToken, secret, payload);
    expect(result.valid).toBe(false);
  });
});

describe('Forged signature rejection — all providers', () => {
  it('Stripe: completely fabricated signature is rejected', () => {
    const payload = JSON.stringify({ id: 'evt_fake', type: 'payment_intent.created' });
    const result = verifyStripeWebhook(payload, 't=9999,v1=deadbeefdeadbeef', 'whsec_real_secret');
    expect(result.valid).toBe(false);
  });

  it('Stripe: replayed signature with wrong payload is rejected', () => {
    const secret = 'whsec_test_replay';
    const stripe = new Stripe('sk_test_placeholder', { apiVersion: '2025-02-24.acacia' });
    const originalPayload = JSON.stringify({ id: 'evt_orig' });
    const sig = stripe.webhooks.generateTestHeaderString({
      payload: originalPayload,
      secret,
    });
    // Attacker replays signature but changes body content
    const tamperedPayload = JSON.stringify({ id: 'evt_tampered', amount: 999999 });
    const result = verifyStripeWebhook(tamperedPayload, sig, secret);
    expect(result.valid).toBe(false);
  });

  it('Paystack: all-zeros signature is rejected', () => {
    const payload = JSON.stringify({ event: 'charge.success' });
    const result = verifyPaystackWebhook(payload, '0'.repeat(128), 'sk_live_real');
    expect(result.valid).toBe(false);
  });

  it('Paystack: tampered body invalidates HMAC', () => {
    const secret = 'sk_test_paystack';
    const original = JSON.stringify({ event: 'charge.success', data: { amount: 100 } });
    const sig = crypto.createHmac('sha512', secret).update(original).digest('hex');
    // Attacker changes amount in body but keeps same sig
    const tampered = JSON.stringify({ event: 'charge.success', data: { amount: 999999 } });
    const result = verifyPaystackWebhook(tampered, sig, secret);
    expect(result.valid).toBe(false);
  });

  it('Telegram: empty string token is rejected', () => {
    const result = verifyTelegramWebhook('', 'real-secret', '{}');
    expect(result.valid).toBe(false);
  });

  it('Telegram: token with correct prefix but extra chars is rejected', () => {
    const secret = 'my-secret-token';
    const result = verifyTelegramWebhook(secret + '-injected', secret, '{}');
    expect(result.valid).toBe(false);
  });
});

describe('verifyTelegramWebhook', () => {
  const secret = 'super-secret-telegram-token';
  const payload = JSON.stringify({ update_id: 1, message: { text: '/start' } });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('should accept a correct secret token', () => {
    const result = verifyTelegramWebhook(secret, secret, payload);
    expect(result.valid).toBe(true);
    expect(result.event).toBeDefined();
  });

  it('should reject a forged / wrong secret token', () => {
    const result = verifyTelegramWebhook('forged-token', secret, payload);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/mismatch/i);
  });

  it('should reject when the header is missing', () => {
    const result = verifyTelegramWebhook(undefined, secret, payload);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('should reject in production when secret is not configured', () => {
    process.env.NODE_ENV = 'production';
    const result = verifyTelegramWebhook(secret, undefined, payload);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  it('should allow through in non-production when secret is not configured', () => {
    process.env.NODE_ENV = 'test';
    const result = verifyTelegramWebhook(secret, undefined, payload);
    expect(result.valid).toBe(true);
  });

  it('should reject a token that differs only in length (no timing shortcut)', () => {
    const shorterToken = secret.slice(0, -3);
    const result = verifyTelegramWebhook(shorterToken, secret, payload);
    expect(result.valid).toBe(false);
  });

  it('should reject a token that is longer than the secret', () => {
    const longerToken = secret + 'extra';
    const result = verifyTelegramWebhook(longerToken, secret, payload);
    expect(result.valid).toBe(false);
  });
});

describe('Forged signature rejection — all providers', () => {
  it('Stripe: completely fabricated signature is rejected', () => {
    const payload = JSON.stringify({ id: 'evt_fake', type: 'payment_intent.created' });
    const result = verifyStripeWebhook(payload, 't=9999,v1=deadbeefdeadbeef', 'whsec_real_secret');
    expect(result.valid).toBe(false);
  });

  it('Stripe: replayed signature with tampered payload is rejected', () => {
    const secret = 'whsec_test_replay';
    const stripe = new Stripe('sk_test_placeholder', { apiVersion: '2025-02-24.acacia' });
    const originalPayload = JSON.stringify({ id: 'evt_orig' });
    const sig = stripe.webhooks.generateTestHeaderString({ payload: originalPayload, secret });
    const tamperedPayload = JSON.stringify({ id: 'evt_tampered', amount: 999999 });
    const result = verifyStripeWebhook(tamperedPayload, sig, secret);
    expect(result.valid).toBe(false);
  });

  it('Paystack: all-zeros signature is rejected', () => {
    const payload = JSON.stringify({ event: 'charge.success' });
    const result = verifyPaystackWebhook(payload, '0'.repeat(128), 'sk_live_real');
    expect(result.valid).toBe(false);
  });

  it('Paystack: tampered body with original HMAC is rejected', () => {
    const secret = 'sk_test_paystack';
    const original = JSON.stringify({ event: 'charge.success', data: { amount: 100 } });
    const sig = crypto.createHmac('sha512', secret).update(original).digest('hex');
    const tampered = JSON.stringify({ event: 'charge.success', data: { amount: 999999 } });
    const result = verifyPaystackWebhook(tampered, sig, secret);
    expect(result.valid).toBe(false);
  });

  it('Telegram: empty string token is rejected', () => {
    const result = verifyTelegramWebhook('', 'real-secret', '{}');
    expect(result.valid).toBe(false);
  });

  it('Telegram: token with correct prefix but extra chars is rejected', () => {
    const secret = 'my-secret-token';
    const result = verifyTelegramWebhook(secret + '-injected', secret, '{}');
    expect(result.valid).toBe(false);
  });
});
