import * as crypto from 'node:crypto';
import {
  SYNCRO_WEBHOOK_HEADERS,
  parseWebhookHeaders,
  verifyWebhookSignature,
  type SyncroWebhookEvent,
} from '../src/webhooks.js';

describe('webhooks', () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({
    id: 'evt_123',
    type: 'subscription.renewed',
    created: 1_700_000_000,
    data: {
      subscription_id: 'sub_1',
      subscription_name: 'Netflix',
      renewed_at: '2026-06-28T00:00:00.000Z',
      amount: 15.99,
      currency: 'USD',
    },
  });

  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  it('verifies valid webhook signatures', () => {
    expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it('rejects invalid webhook signatures', () => {
    expect(verifyWebhookSignature(payload, 'deadbeef', secret)).toBe(false);
    expect(verifyWebhookSignature(payload, signature, 'wrong-secret')).toBe(false);
  });

  it('parses replay and retry headers', () => {
    const headers = parseWebhookHeaders({
      [SYNCRO_WEBHOOK_HEADERS.signature]: signature,
      [SYNCRO_WEBHOOK_HEADERS.deliveryId]: 'del_123',
      [SYNCRO_WEBHOOK_HEADERS.retryCount]: '2',
      [SYNCRO_WEBHOOK_HEADERS.replayId]: 'replay_456',
    });

    expect(headers).toEqual({
      signature,
      deliveryId: 'del_123',
      retryCount: 2,
      replayId: 'replay_456',
    });
  });

  it('supports discriminated union event typing', () => {
    const event = JSON.parse(payload) as SyncroWebhookEvent;
    if (event.type === 'subscription.renewed') {
      expect(event.data.subscription_name).toBe('Netflix');
    } else {
      throw new Error('Expected subscription.renewed event');
    }
  });
});
