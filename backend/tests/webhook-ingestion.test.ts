/**
 * Unified inbound webhook ingestion pipeline (issue #1283).
 *
 * Covers the five acceptance criteria: one pipeline for every provider,
 * rejection before persistence, provider-scoped deduplication, no
 * acknowledgement without durable persistence, and idempotent replay.
 */

import type { Request } from 'express';
import { FakeSupabase } from './helpers/fake-supabase';

const fakeDb = new FakeSupabase();

jest.mock('../src/config/database', () => ({
  supabase: { from: (table: string) => fakeDb.from(table) },
}));

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const verifyStripeWebhook = jest.fn();
const verifyPayPalWebhook = jest.fn();
const verifyPaystackWebhook = jest.fn();
const verifyTelegramWebhook = jest.fn();

jest.mock('../src/services/payment-webhook-verification', () => ({
  verifyStripeWebhook: (...args: unknown[]) => verifyStripeWebhook(...args),
  verifyPayPalWebhook: (...args: unknown[]) => verifyPayPalWebhook(...args),
  verifyPaystackWebhook: (...args: unknown[]) => verifyPaystackWebhook(...args),
  verifyTelegramWebhook: (...args: unknown[]) => verifyTelegramWebhook(...args),
}));

import {
  ingestWebhook,
  processStoredEvent,
  replayWebhookEvent,
  retryDueWebhookEvents,
  registerWebhookHandler,
  clearWebhookHandlers,
  stripeAdapter,
  paypalAdapter,
  paystackAdapter,
  telegramAdapter,
  PROVIDER_ADAPTERS,
  type StoredWebhookEvent,
} from '../src/services/webhook-ingestion';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return {
    body: Buffer.from(JSON.stringify(body), 'utf8'),
    headers,
    ip: '203.0.113.10',
  } as unknown as Request;
}

function verified(event: unknown, provider: string) {
  return { valid: true, provider, event };
}

function rejected(provider: string, error: string) {
  return { valid: false, provider, error };
}

const stripeEvent = { id: 'evt_1', type: 'payment_intent.succeeded' };
const paypalEvent = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' };
const paystackEvent = { event: 'charge.success', data: { reference: 'ref_12345' } };
const telegramUpdate = { update_id: 77, message: { text: '/help', chat: { id: 5 } } };

/** Let the fire-and-forget `setImmediate` dispatch run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  fakeDb.reset();
  clearWebhookHandlers();

  verifyStripeWebhook.mockReturnValue(verified(stripeEvent, 'stripe'));
  verifyPayPalWebhook.mockResolvedValue(verified(paypalEvent, 'paypal'));
  verifyPaystackWebhook.mockReturnValue(verified(paystackEvent, 'paystack'));
  verifyTelegramWebhook.mockReturnValue(verified(telegramUpdate, 'telegram'));
});

// ─── One pipeline, adapters only ─────────────────────────────────────────────

describe('one pipeline for every provider', () => {
  it('registers an adapter for all four providers', () => {
    expect(Object.keys(PROVIDER_ADAPTERS).sort()).toEqual([
      'paypal',
      'paystack',
      'stripe',
      'telegram',
    ]);
  });

  it.each([
    ['stripe', stripeAdapter, stripeEvent, 'evt_1', 'payment_intent.succeeded'],
    ['paypal', paypalAdapter, paypalEvent, 'WH-1', 'PAYMENT.CAPTURE.COMPLETED'],
    ['paystack', paystackAdapter, paystackEvent, 'ref_12345', 'charge.success'],
    ['telegram', telegramAdapter, telegramUpdate, '77', 'message'],
  ])(
    '%s ingests through the same pipeline and stores a normalised row',
    async (provider, adapter, event, expectedId, expectedType) => {
      const outcome = await ingestWebhook(adapter, makeRequest(event));

      expect(outcome).toMatchObject({ kind: 'accepted', status: 202, eventId: expectedId });

      const [row] = fakeDb.rows('webhook_events');
      expect(row).toMatchObject({
        provider,
        event_id: expectedId,
        event_type: expectedType,
        status: 'pending',
        attempts: 0,
      });
    },
  );

  it('extracts the id from each provider its own way', () => {
    expect(stripeAdapter.extractEventId({ id: 'evt_9' })).toBe('evt_9');
    expect(paypalAdapter.extractEventId({ id: 'WH-9' })).toBe('WH-9');
    expect(paystackAdapter.extractEventId({ data: { reference: 'ref_9' } })).toBe('ref_9');
    expect(telegramAdapter.extractEventId({ update_id: 12 })).toBe('12');
  });
});

// ─── Rejection ───────────────────────────────────────────────────────────────

describe('signature verification failure', () => {
  it('returns 4xx and persists no event', async () => {
    verifyStripeWebhook.mockReturnValue(rejected('stripe', 'signature mismatch'));

    const outcome = await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));

    expect(outcome).toMatchObject({ kind: 'rejected', status: 400 });
    expect(fakeDb.rows('webhook_events')).toHaveLength(0);
  });

  it('persists an audit record, without the unverified body', async () => {
    verifyPaystackWebhook.mockReturnValue(rejected('paystack', 'signature mismatch'));

    await ingestWebhook(paystackAdapter, makeRequest(paystackEvent));

    const [rejection] = fakeDb.rows('webhook_rejections');
    expect(rejection).toMatchObject({
      provider: 'paystack',
      reason: 'signature mismatch',
      http_status: 400,
      source_ip: '203.0.113.10',
    });
    expect(rejection.payload_bytes).toBeGreaterThan(0);
    // The body itself must never be stored.
    expect(Object.keys(rejection)).not.toContain('event_data');
    expect(JSON.stringify(rejection)).not.toContain('ref_12345');
  });

  it('uses the provider-appropriate rejection status', async () => {
    verifyPayPalWebhook.mockResolvedValue(rejected('paypal', 'bad signature'));
    const paypal = await ingestWebhook(paypalAdapter, makeRequest(paypalEvent));
    expect(paypal).toMatchObject({ status: 401 });

    verifyTelegramWebhook.mockReturnValue(rejected('telegram', 'bad secret'));
    const telegram = await ingestWebhook(telegramAdapter, makeRequest(telegramUpdate));
    expect(telegram).toMatchObject({ status: 403 });
  });

  it('rejects a verified event that carries no id, and stores nothing', async () => {
    verifyStripeWebhook.mockReturnValue(verified({ type: 'x.y' }, 'stripe'));

    const outcome = await ingestWebhook(stripeAdapter, makeRequest({}));

    expect(outcome).toMatchObject({ kind: 'malformed', status: 400, reason: 'missing_event_id' });
    expect(fakeDb.rows('webhook_events')).toHaveLength(0);
    expect(fakeDb.rows('webhook_rejections')).toHaveLength(1);
  });
});

// ─── Deduplication ───────────────────────────────────────────────────────────

describe('deduplication scoped by (provider, event id)', () => {
  it('accepts the first delivery and reports the second as a duplicate', async () => {
    const first = await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    const second = await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));

    expect(first.kind).toBe('accepted');
    expect(second).toMatchObject({ kind: 'duplicate', status: 200, eventId: 'evt_1' });
    expect(fakeDb.rows('webhook_events')).toHaveLength(1);
  });

  it('does not treat the same id from a different provider as a duplicate', async () => {
    // The bug this prevents: dedup or `processed` scoped by event id alone.
    verifyStripeWebhook.mockReturnValue(verified({ id: 'shared-id', type: 'a' }, 'stripe'));
    verifyPayPalWebhook.mockResolvedValue(verified({ id: 'shared-id', event_type: 'b' }, 'paypal'));

    const stripe = await ingestWebhook(stripeAdapter, makeRequest({}));
    const paypal = await ingestWebhook(paypalAdapter, makeRequest({}));

    expect(stripe.kind).toBe('accepted');
    expect(paypal.kind).toBe('accepted');
    expect(fakeDb.rows('webhook_events')).toHaveLength(2);
  });

  it('keeps processed state per provider', async () => {
    verifyStripeWebhook.mockReturnValue(verified({ id: 'shared-id', type: 'a' }, 'stripe'));
    verifyPayPalWebhook.mockResolvedValue(verified({ id: 'shared-id', event_type: 'b' }, 'paypal'));

    await ingestWebhook(stripeAdapter, makeRequest({}));
    await ingestWebhook(paypalAdapter, makeRequest({}));
    await flush();

    const rows = fakeDb.rows('webhook_events');
    const stripeRow = rows.find((r) => r.provider === 'stripe');
    const paypalRow = rows.find((r) => r.provider === 'paypal');
    expect(stripeRow?.status).toBe('processed');
    expect(paypalRow?.status).toBe('processed');
    expect(stripeRow?.id).not.toBe(paypalRow?.id);
  });
});

// ─── Persistence failure ─────────────────────────────────────────────────────

describe('acknowledgement requires durable persistence', () => {
  it('does not acknowledge when the insert returns an error', async () => {
    fakeDb.failInsertFor.add('webhook_events');

    const outcome = await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));

    expect(outcome).toMatchObject({ kind: 'persistence_failed', status: 503 });
    expect(fakeDb.rows('webhook_events')).toHaveLength(0);
  });

  it('does not acknowledge when the insert throws', async () => {
    fakeDb.throwInsertFor.add('webhook_events');

    const outcome = await ingestWebhook(paystackAdapter, makeRequest(paystackEvent));

    expect(outcome).toMatchObject({ kind: 'persistence_failed', status: 503 });
  });

  it('does not run any handler when persistence fails', async () => {
    const handler = jest.fn();
    registerWebhookHandler('stripe', 'payment_intent.succeeded', handler);
    fakeDb.failInsertFor.add('webhook_events');

    await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    await flush();

    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── Processing ──────────────────────────────────────────────────────────────

describe('asynchronous processing from the stored record', () => {
  it('runs the registered handler and marks the row processed', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    registerWebhookHandler('stripe', 'payment_intent.succeeded', handler);

    await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
    const [row] = fakeDb.rows('webhook_events');
    expect(row).toMatchObject({ status: 'processed', processed: true, attempts: 1 });
    expect(row.processed_at).toBeTruthy();
  });

  it('treats an unregistered event type as a successful no-op', async () => {
    await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    await flush();

    expect(fakeDb.rows('webhook_events')[0]).toMatchObject({ status: 'processed' });
  });

  it('marks the row failed and schedules a retry when the handler throws', async () => {
    registerWebhookHandler('stripe', 'payment_intent.succeeded', async () => {
      throw new Error('downstream down');
    });

    await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    await flush();

    const [row] = fakeDb.rows('webhook_events');
    expect(row).toMatchObject({ status: 'failed', attempts: 1, last_error: 'downstream down' });
    expect(row.next_attempt_at).toBeTruthy();
  });

  it('skips a row that is already processed', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    registerWebhookHandler('stripe', 'payment_intent.succeeded', handler);

    await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    await flush();
    const recordId = fakeDb.rows('webhook_events')[0].id as string;

    const result = await processStoredEvent(recordId);

    expect(result.status).toBe('skipped');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reports not_found for an unknown record', async () => {
    expect(await processStoredEvent('nope')).toMatchObject({ status: 'not_found' });
  });

  it('dead-letters once attempts are exhausted', async () => {
    registerWebhookHandler('stripe', 'payment_intent.succeeded', async () => {
      throw new Error('always fails');
    });

    await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    await flush();
    const recordId = fakeDb.rows('webhook_events')[0].id as string;

    // Default WEBHOOK_MAX_ATTEMPTS is 5; the ingest above already used one.
    for (let i = 0; i < 4; i++) await processStoredEvent(recordId);

    expect(fakeDb.rows('webhook_events')[0]).toMatchObject({
      status: 'dead_letter',
      attempts: 5,
    });
  });
});

// ─── Retry sweeper ───────────────────────────────────────────────────────────

describe('retry sweeper', () => {
  it('recovers a failed event without the provider redelivering', async () => {
    let attempts = 0;
    registerWebhookHandler('stripe', 'payment_intent.succeeded', async () => {
      attempts++;
      if (attempts === 1) throw new Error('transient');
    });

    await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    await flush();
    expect(fakeDb.rows('webhook_events')[0].status).toBe('failed');

    // Backoff has not elapsed, so nothing is due yet.
    expect(await retryDueWebhookEvents()).toBe(0);

    // Simulate the backoff window passing.
    fakeDb.rows('webhook_events')[0].next_attempt_at = new Date(Date.now() - 1000).toISOString();

    expect(await retryDueWebhookEvents()).toBe(1);
    expect(fakeDb.rows('webhook_events')[0]).toMatchObject({ status: 'processed', attempts: 2 });
  });

  it('leaves dead-lettered events alone', async () => {
    fakeDb.rows('webhook_events').push({
      id: 'dead-1',
      provider: 'stripe',
      event_id: 'evt_dead',
      event_type: 'payment_intent.succeeded',
      event_data: {},
      status: 'dead_letter',
      attempts: 5,
      processed: false,
      next_attempt_at: null,
    });

    expect(await retryDueWebhookEvents()).toBe(0);
  });
});

// ─── Replay ──────────────────────────────────────────────────────────────────

describe('operator replay', () => {
  it('re-runs a processed event and records an audit row', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    registerWebhookHandler('stripe', 'payment_intent.succeeded', handler);

    await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);

    const recordId = fakeDb.rows('webhook_events')[0].id as string;
    const result = await replayWebhookEvent({
      recordId,
      requestedBy: 'operator-1',
      reason: 'provider reported a gap',
    });

    expect(result.status).toBe('processed');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(fakeDb.rows('webhook_replays')[0]).toMatchObject({
      webhook_event_id: recordId,
      requested_by: 'operator-1',
      reason: 'provider reported a gap',
      outcome: 'processed',
    });
  });

  it('finds the event by provider and event id', async () => {
    await ingestWebhook(paystackAdapter, makeRequest(paystackEvent));
    await flush();

    const result = await replayWebhookEvent({ provider: 'paystack', eventId: 'ref_12345' });

    expect(result.status).toBe('processed');
    expect(result.recordId).toBeTruthy();
  });

  it('is safe to repeat, because handlers are idempotent', async () => {
    // A handler whose effect is an upsert — the shape every handler must have.
    const store = new Map<string, number>();
    registerWebhookHandler('paystack', 'charge.success', async (event: StoredWebhookEvent) => {
      store.set(event.event_id, 1);
    });

    await ingestWebhook(paystackAdapter, makeRequest(paystackEvent));
    await flush();

    for (let i = 0; i < 3; i++) {
      await replayWebhookEvent({ provider: 'paystack', eventId: 'ref_12345' });
    }

    expect(store.size).toBe(1);
    expect(store.get('ref_12345')).toBe(1);
  });

  it('reports not_found for an event that was never stored', async () => {
    const result = await replayWebhookEvent({ provider: 'stripe', eventId: 'missing' });
    expect(result.status).toBe('not_found');
  });

  it('requires either a record id or a provider and event id', async () => {
    const result = await replayWebhookEvent({ provider: 'stripe' });
    expect(result).toMatchObject({ status: 'not_found' });
  });

  it('records the failure outcome when a replayed handler throws', async () => {
    registerWebhookHandler('stripe', 'payment_intent.succeeded', async () => {
      throw new Error('still broken');
    });

    await ingestWebhook(stripeAdapter, makeRequest(stripeEvent));
    await flush();
    const recordId = fakeDb.rows('webhook_events')[0].id as string;

    await replayWebhookEvent({ recordId, requestedBy: 'operator-1' });

    expect(fakeDb.rows('webhook_replays')[0]).toMatchObject({
      outcome: 'failed',
      error: 'still broken',
    });
  });
});
