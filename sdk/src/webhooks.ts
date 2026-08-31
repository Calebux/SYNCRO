import * as crypto from 'node:crypto';

/**
 * Canonical SYNCRO outbound webhook event types.
 * Mirrors backend/src/types/webhook.ts.
 */
export type SyncroWebhookEventType =
  | 'subscription.renewal_due'
  | 'subscription.renewed'
  | 'subscription.renewal_failed'
  | 'subscription.cancelled'
  | 'subscription.risk_score_changed'
  | 'reminder.sent'
  | 'test.event';

export interface SyncroWebhookEventPayloadMap {
  'subscription.renewal_due': {
    subscription_id: string;
    subscription_name: string;
    renewal_date: string;
    amount: number;
    currency: string;
  };
  'subscription.renewed': {
    subscription_id: string;
    subscription_name: string;
    renewed_at: string;
    amount: number;
    currency: string;
  };
  'subscription.renewal_failed': {
    subscription_id: string;
    subscription_name: string;
    failed_at: string;
    reason: string;
  };
  'subscription.cancelled': {
    subscription_id: string;
    subscription_name: string;
    cancelled_at: string;
  };
  'subscription.risk_score_changed': {
    subscription_id: string;
    subscription_name: string;
    previous_score: number;
    new_score: number;
  };
  'reminder.sent': {
    subscription_id: string;
    subscription_name: string;
    reminder_type: string;
    sent_at: string;
  };
  'test.event': {
    message: string;
  };
}

export interface SyncroWebhookEnvelope<T extends SyncroWebhookEventType = SyncroWebhookEventType> {
  id: string;
  type: T;
  created: number;
  data: SyncroWebhookEventPayloadMap[T];
}

/** Discriminated union for type-safe webhook event handling. */
export type SyncroWebhookEvent = {
  [K in SyncroWebhookEventType]: SyncroWebhookEnvelope<K>;
}[SyncroWebhookEventType];

/** Standard SYNCRO webhook delivery headers. */
export const SYNCRO_WEBHOOK_HEADERS = {
  signature: 'x-syncro-signature',
  deliveryId: 'x-syncro-delivery-id',
  retryCount: 'x-syncro-retry-count',
  replayId: 'x-syncro-replay-id',
} as const;

export interface SyncroWebhookDeliveryHeaders {
  signature?: string;
  deliveryId?: string;
  retryCount?: number;
  replayId?: string;
}

export type WebhookHeaderInput = Record<string, string | string[] | undefined>;

/**
 * Parse SYNCRO webhook delivery metadata from request headers.
 */
export function parseWebhookHeaders(headers: WebhookHeaderInput): SyncroWebhookDeliveryHeaders {
  const get = (name: string): string | undefined => {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  };

  const retryRaw = get(SYNCRO_WEBHOOK_HEADERS.retryCount);
  const retryCount = retryRaw !== undefined ? Number.parseInt(retryRaw, 10) : undefined;

  return {
    signature: get(SYNCRO_WEBHOOK_HEADERS.signature),
    deliveryId: get(SYNCRO_WEBHOOK_HEADERS.deliveryId),
    retryCount: Number.isFinite(retryCount) ? retryCount : undefined,
    replayId: get(SYNCRO_WEBHOOK_HEADERS.replayId),
  };
}

/**
 * Verify a SYNCRO webhook signature.
 *
 * SYNCRO signs the raw JSON payload string with HMAC-SHA256 using the webhook
 * secret and sends the hex digest in `X-Syncro-Signature`.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!payload || !signature || !secret) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  try {
    const received = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (received.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(received, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Parse and verify a webhook request in one step.
 */
export function parseVerifiedWebhookEvent(
  rawBody: string,
  headers: WebhookHeaderInput,
  secret: string,
): SyncroWebhookEvent | null {
  const parsedHeaders = parseWebhookHeaders(headers);
  if (!parsedHeaders.signature) {
    return null;
  }

  if (!verifyWebhookSignature(rawBody, parsedHeaders.signature, secret)) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as SyncroWebhookEvent;
  } catch {
    return null;
  }
}

/**
 * Example webhook handler for Express-style frameworks.
 */
export function createWebhookHandler<T extends SyncroWebhookEventType>(
  secret: string,
  handlers: Partial<{
    [K in SyncroWebhookEventType]: (event: SyncroWebhookEnvelope<K>) => void | Promise<void>;
  }>,
): (rawBody: string, headers: WebhookHeaderInput) => Promise<{ status: number; body: string }> {
  return async (rawBody, headers) => {
    const event = parseVerifiedWebhookEvent(rawBody, headers, secret);
    if (!event) {
      return { status: 401, body: 'Invalid webhook signature' };
    }

    const handler = handlers[event.type as T];
    if (handler) {
      await handler(event as SyncroWebhookEnvelope<T>);
    }

    return { status: 200, body: 'OK' };
  };
}
