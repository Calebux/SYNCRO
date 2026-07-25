import crypto from 'crypto';
import Stripe from 'stripe';
import logger from '../config/logger';
import { webhookSignatureAlertService } from './webhook-signature-alert-service';

export type PaymentWebhookProvider = 'stripe' | 'paystack' | 'paypal';

export interface WebhookVerificationResult {
  valid: boolean;
  provider: PaymentWebhookProvider;
  event?: unknown;
  error?: string;
}

export interface PayPalVerificationHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

/**
 * Verify Stripe webhook signature using stripe.webhooks.constructEvent.
 */
export function verifyStripeWebhook(
  rawBody: string | Buffer,
  signature: string | undefined,
  secret: string | undefined,
): WebhookVerificationResult {
  const provider: PaymentWebhookProvider = 'stripe';

  if (!signature || !secret) {
    webhookSignatureAlertService.recordFailure(provider, { reason: 'missing_signature_or_secret' });
    return { valid: false, provider, error: 'Missing stripe-signature header or STRIPE_WEBHOOK_SECRET' };
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
      apiVersion: '2025-02-24.acacia',
    });
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const event = stripe.webhooks.constructEvent(body, signature, secret);
    webhookSignatureAlertService.recordSuccess(provider);
    return { valid: true, provider, event };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    webhookSignatureAlertService.recordFailure(provider, { reason: message });
    logger.warn('[StripeWebhook] Signature verification failed', { reason: message });
    return { valid: false, provider, error: message };
  }
}

/**
 * Verify Paystack webhook signature using HMAC SHA-512.
 * Reference: https://paystack.com/docs/payments/webhooks/#verify-events
 */
export function verifyPaystackWebhook(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string | undefined,
): WebhookVerificationResult {
  const provider: PaymentWebhookProvider = 'paystack';

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      webhookSignatureAlertService.recordFailure(provider, { reason: 'secret_not_configured' });
      return { valid: false, provider, error: 'PAYSTACK_SECRET_KEY not configured' };
    }
    logger.warn('[PaystackWebhook] PAYSTACK_SECRET_KEY not set — skipping check (non-production)');
    return { valid: true, provider };
  }

  if (!signature) {
    webhookSignatureAlertService.recordFailure(provider, { reason: 'missing_signature' });
    return { valid: false, provider, error: 'Missing x-paystack-signature header' };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const hash = crypto.createHmac('sha512', secret).update(body).digest('hex');

  try {
    const isValid = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(signature, 'hex'));
    if (!isValid) {
      webhookSignatureAlertService.recordFailure(provider, { reason: 'signature_mismatch' });
      return { valid: false, provider, error: 'Signature mismatch' };
    }
    webhookSignatureAlertService.recordSuccess(provider);
    const event = JSON.parse(body.toString('utf8'));
    return { valid: true, provider, event };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    webhookSignatureAlertService.recordFailure(provider, { reason: message });
    return { valid: false, provider, error: message };
  }
}

/**
 * Verify PayPal webhook signature via PayPal API.
 * Reference: https://developer.paypal.com/api/rest/webhooks/rest/#verify-webhook-signature
 */
export async function verifyPayPalWebhook(
  rawBody: string,
  headers: Partial<PayPalVerificationHeaders>,
  config: { webhookId?: string; clientId?: string; clientSecret?: string; mode?: string },
): Promise<WebhookVerificationResult> {
  const provider: PaymentWebhookProvider = 'paypal';
  const { webhookId, clientId, clientSecret, mode = 'sandbox' } = config;

  if (!webhookId) {
    if (process.env.NODE_ENV === 'production') {
      webhookSignatureAlertService.recordFailure(provider, { reason: 'webhook_id_not_configured' });
      return { valid: false, provider, error: 'PAYPAL_WEBHOOK_ID not configured' };
    }
    logger.warn('[PayPalWebhook] PAYPAL_WEBHOOK_ID not set — skipping check (non-production)');
    return { valid: true, provider, event: JSON.parse(rawBody) };
  }

  const { transmissionId, transmissionTime, certUrl, authAlgo, transmissionSig } = headers;
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    webhookSignatureAlertService.recordFailure(provider, { reason: 'missing_headers' });
    return { valid: false, provider, error: 'Missing PayPal transmission headers' };
  }

  if (!clientId || !clientSecret) {
    webhookSignatureAlertService.recordFailure(provider, { reason: 'credentials_not_configured' });
    return { valid: false, provider, error: 'PayPal credentials not configured' };
  }

  const baseUrl = mode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!tokenResponse.ok) {
      webhookSignatureAlertService.recordFailure(provider, { reason: 'token_fetch_failed' });
      return { valid: false, provider, error: 'Failed to obtain PayPal access token' };
    }

    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    const verifyResponse = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        cert_url: certUrl,
        auth_algo: authAlgo,
        transmission_sig: transmissionSig,
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody),
      }),
    });

    if (!verifyResponse.ok) {
      webhookSignatureAlertService.recordFailure(provider, { reason: 'api_verification_failed' });
      return { valid: false, provider, error: 'PayPal signature verification API failed' };
    }

    const verifyData = (await verifyResponse.json()) as { verification_status: string };
    if (verifyData.verification_status !== 'SUCCESS') {
      webhookSignatureAlertService.recordFailure(provider, {
        reason: 'verification_status_not_success',
        status: verifyData.verification_status,
      });
      return { valid: false, provider, error: 'PayPal verification_status !== SUCCESS' };
    }

    webhookSignatureAlertService.recordSuccess(provider);
    return { valid: true, provider, event: JSON.parse(rawBody) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    webhookSignatureAlertService.recordFailure(provider, { reason: message });
    return { valid: false, provider, error: message };
  }
}
