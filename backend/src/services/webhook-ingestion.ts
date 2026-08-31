/**
 * Unified inbound webhook ingestion pipeline (issue #1283).
 *
 * Five webhook route files each implemented their own signature verification,
 * deduplication, persistence and error handling. Bugs that appeared in one —
 * PayPal ignoring persistence errors, `processed` state that was not scoped by
 * provider — were absent from the others only because they had been written
 * separately. There is now one pipeline and the providers contribute nothing
 * but a verification adapter.
 *
 * The pipeline, in order:
 *
 *   verify signature -> persist raw event -> deduplicate by (provider, event id)
 *   -> enqueue -> acknowledge
 *
 * Two invariants matter most:
 *
 *   - **Acknowledge only after durable persistence.** If the insert fails the
 *     provider gets a 5xx and retries. Acknowledging after in-memory handling
 *     loses the event on a crash.
 *   - **The stored row is the queue.** Processing reads the persisted record,
 *     so a handler failure retries from our side rather than depending on the
 *     provider to redeliver.
 */

import type { Request } from 'express';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { env } from '../config/env';
import {
  verifyPayPalWebhook,
  verifyPaystackWebhook,
  verifyStripeWebhook,
  verifyTelegramWebhook,
  type WebhookVerificationResult,
} from './payment-webhook-verification';

// ─── Types ───────────────────────────────────────────────────────────────────

export type WebhookProvider = 'stripe' | 'paypal' | 'paystack' | 'telegram';

export type WebhookEventStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'dead_letter';

/** A stored delivery. This row is both the audit record and the work queue. */
export interface StoredWebhookEvent {
  id: string;
  provider: WebhookProvider;
  event_id: string;
  event_type: string;
  event_data: unknown;
  status: WebhookEventStatus;
  attempts: number;
  processed: boolean | null;
  processed_at: string | null;
  last_error: string | null;
}

/**
 * Everything a provider must supply. Verification is provider-specific;
 * nothing else is.
 */
export interface ProviderAdapter {
  provider: WebhookProvider;
  /** Verify the delivery. Must not have side effects beyond alert counters. */
  verify(req: Request): WebhookVerificationResult | Promise<WebhookVerificationResult>;
  /** The provider's own id for this event — the deduplication key. */
  extractEventId(event: unknown): string | null;
  /** Provider event type, used to route to a handler. */
  extractEventType(event: unknown): string;
  /** HTTP status returned when verification fails. */
  rejectionStatus: number;
  /**
   * Client-facing rejection message. Deliberately fixed per provider: the real
   * reason is logged and audited but never returned, because it comes from an
   * unauthenticated caller and can describe our own configuration.
   */
  rejectionMessage: string;
}

export type IngestOutcome =
  | { kind: 'rejected'; status: number; reason: string }
  | { kind: 'malformed'; status: number; reason: string }
  | { kind: 'duplicate'; status: 200; eventId: string }
  | { kind: 'accepted'; status: 202; eventId: string; recordId: string }
  | { kind: 'persistence_failed'; status: 503; reason: string };

/** A handler for one provider event type. Must be idempotent. */
export type WebhookHandler = (event: StoredWebhookEvent) => Promise<void>;

// ─── Raw body helpers ────────────────────────────────────────────────────────

/**
 * Signature verification must run over the exact bytes the provider signed.
 * The payment webhook routes mount `express.raw`, so `req.body` is a Buffer;
 * the fallback keeps non-raw mounts (Telegram) working.
 */
export function rawBodyBuffer(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) return req.body;
  return Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

// ─── Provider adapters ───────────────────────────────────────────────────────

export const stripeAdapter: ProviderAdapter = {
  provider: 'stripe',
  rejectionMessage: 'Webhook signature verification failed',
  rejectionStatus: 400,
  verify: (req) =>
    verifyStripeWebhook(
      rawBodyBuffer(req),
      headerValue(req, 'stripe-signature'),
      env.STRIPE_WEBHOOK_SECRET,
    ),
  extractEventId: (event) => (event as { id?: string } | null)?.id ?? null,
  extractEventType: (event) => (event as { type?: string } | null)?.type ?? 'unknown',
};

export const paypalAdapter: ProviderAdapter = {
  provider: 'paypal',
  rejectionMessage: 'Invalid signature',
  rejectionStatus: 401,
  verify: (req) =>
    verifyPayPalWebhook(
      rawBodyBuffer(req).toString('utf8'),
      {
        transmissionId: headerValue(req, 'paypal-transmission-id') as string,
        transmissionTime: headerValue(req, 'paypal-transmission-time') as string,
        certUrl: headerValue(req, 'paypal-cert-url') as string,
        authAlgo: headerValue(req, 'paypal-auth-algo') as string,
        transmissionSig: headerValue(req, 'paypal-transmission-sig') as string,
      },
      {
        webhookId: env.PAYPAL_WEBHOOK_ID,
        clientId: env.PAYPAL_CLIENT_ID,
        clientSecret: env.PAYPAL_CLIENT_SECRET,
        mode: env.PAYPAL_MODE,
      },
    ),
  extractEventId: (event) => (event as { id?: string } | null)?.id ?? null,
  extractEventType: (event) => (event as { event_type?: string } | null)?.event_type ?? 'unknown',
};

export const paystackAdapter: ProviderAdapter = {
  provider: 'paystack',
  rejectionMessage: 'Webhook signature verification failed',
  rejectionStatus: 400,
  verify: (req) =>
    verifyPaystackWebhook(
      rawBodyBuffer(req),
      headerValue(req, 'x-paystack-signature'),
      env.PAYSTACK_SECRET_KEY,
    ),
  // Paystack does not send an event id; the transaction reference is the
  // idempotency key it documents for this purpose.
  extractEventId: (event) => {
    const data = (event as { data?: { reference?: string } } | null)?.data;
    return data?.reference ?? null;
  },
  extractEventType: (event) => (event as { event?: string } | null)?.event ?? 'unknown',
};

export const telegramAdapter: ProviderAdapter = {
  provider: 'telegram',
  rejectionMessage: 'Invalid secret token',
  rejectionStatus: 403,
  verify: (req) =>
    verifyTelegramWebhook(
      headerValue(req, 'x-telegram-bot-api-secret-token'),
      env.TELEGRAM_WEBHOOK_SECRET,
      rawBodyBuffer(req),
    ),
  extractEventId: (event) => {
    const updateId = (event as { update_id?: number } | null)?.update_id;
    return updateId === undefined || updateId === null ? null : String(updateId);
  },
  extractEventType: (event) => {
    const update = event as Record<string, unknown> | null;
    if (!update) return 'unknown';
    if (update.message) return 'message';
    if (update.callback_query) return 'callback_query';
    if (update.edited_message) return 'edited_message';
    return 'unknown';
  },
};

export const PROVIDER_ADAPTERS: Record<WebhookProvider, ProviderAdapter> = {
  stripe: stripeAdapter,
  paypal: paypalAdapter,
  paystack: paystackAdapter,
  telegram: telegramAdapter,
};

// ─── Handler registry ────────────────────────────────────────────────────────

const handlers = new Map<string, WebhookHandler>();

function handlerKey(provider: WebhookProvider, eventType: string): string {
  return `${provider}:${eventType}`;
}

/**
 * Register a handler for one provider event type.
 *
 * Handlers must be idempotent: replay re-runs them against an already-processed
 * record on purpose, and the retry sweeper may re-run one whose failure happened
 * after a partial side effect.
 */
export function registerWebhookHandler(
  provider: WebhookProvider,
  eventType: string,
  handler: WebhookHandler,
): void {
  handlers.set(handlerKey(provider, eventType), handler);
}

export function getWebhookHandler(
  provider: WebhookProvider,
  eventType: string,
): WebhookHandler | undefined {
  return handlers.get(handlerKey(provider, eventType));
}

/** Test hook. */
export function clearWebhookHandlers(): void {
  handlers.clear();
}

// ─── Rejection audit ─────────────────────────────────────────────────────────

/**
 * Record a delivery that never made it past verification.
 *
 * Only metadata is stored. The body failed verification, so it is unauthenticated
 * attacker-controlled input and must not be persisted.
 */
async function auditRejection(
  provider: WebhookProvider,
  reason: string,
  httpStatus: number,
  req: Request,
): Promise<void> {
  try {
    const { error } = await supabase.from('webhook_rejections').insert({
      provider,
      reason,
      http_status: httpStatus,
      source_ip: req.ip ?? null,
      payload_bytes: rawBodyBuffer(req).length,
      created_at: new Date().toISOString(),
    });
    if (error) {
      logger.error('[webhook-ingest] Failed to record rejection', {
        provider,
        error: error.message,
      });
    }
  } catch (err) {
    logger.error('[webhook-ingest] Failed to record rejection', {
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Ingestion ───────────────────────────────────────────────────────────────

const UNIQUE_VIOLATION = '23505';

/**
 * Run a delivery through the pipeline.
 *
 * Returns an outcome rather than writing to the response, so routes stay thin
 * and the pipeline stays testable without HTTP.
 */
export async function ingestWebhook(
  adapter: ProviderAdapter,
  req: Request,
): Promise<IngestOutcome> {
  const { provider } = adapter;

  // 1. Verify. A failure persists nothing but an audit record.
  const verification = await adapter.verify(req);
  if (!verification.valid) {
    const reason = verification.error ?? 'signature_verification_failed';
    logger.warn('[webhook-ingest] Rejected delivery', { provider, reason });
    await auditRejection(provider, reason, adapter.rejectionStatus, req);
    return { kind: 'rejected', status: adapter.rejectionStatus, reason };
  }

  const event = verification.event;
  const eventId = adapter.extractEventId(event);
  if (!eventId) {
    const reason = 'missing_event_id';
    logger.warn('[webhook-ingest] Verified delivery carries no event id', { provider });
    await auditRejection(provider, reason, 400, req);
    return { kind: 'malformed', status: 400, reason };
  }

  const eventType = adapter.extractEventType(event);

  // 2 & 3. Persist and deduplicate in one step: the unique constraint on
  // (provider, event_id) is the deduplication mechanism, so a concurrent
  // redelivery loses the race instead of being processed twice.
  let record: { id: string } | null = null;
  try {
    const { data, error } = await supabase
      .from('webhook_events')
      .insert({
        provider,
        event_id: eventId,
        event_type: eventType,
        event_data: event,
        status: 'pending',
        attempts: 0,
        processed: false,
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        logger.info('[webhook-ingest] Duplicate delivery ignored', { provider, eventId });
        return { kind: 'duplicate', status: 200, eventId };
      }
      // Do not acknowledge — the provider must retry.
      logger.error('[webhook-ingest] Persistence failed; not acknowledging', {
        provider,
        eventId,
        error: error.message,
      });
      return { kind: 'persistence_failed', status: 503, reason: error.message };
    }

    record = data as { id: string } | null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error('[webhook-ingest] Persistence threw; not acknowledging', {
      provider,
      eventId,
      error: reason,
    });
    return { kind: 'persistence_failed', status: 503, reason };
  }

  if (!record?.id) {
    return { kind: 'persistence_failed', status: 503, reason: 'insert returned no row' };
  }

  // 4. Enqueue. The row is already durable, so this hand-off is allowed to be
  // in-process: if it is lost, the retry sweeper picks the row up.
  void dispatchStoredEvent(record.id);

  // 5. Acknowledge.
  return { kind: 'accepted', status: 202, eventId, recordId: record.id };
}

// ─── Processing ──────────────────────────────────────────────────────────────

/** Exponential backoff, capped, for handler retries. */
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, 15 * 60 * 1000);
}

const MAX_ATTEMPTS = Number(env.WEBHOOK_MAX_ATTEMPTS);

export interface ProcessOptions {
  /** Replay: run the handler even if the record is already processed. */
  force?: boolean;
}

export interface ProcessResult {
  status: 'processed' | 'skipped' | 'failed' | 'dead_letter' | 'not_found';
  error?: string;
}

/**
 * Process one stored event.
 *
 * Idempotent by default: an already-processed record is skipped, which is what
 * makes both the retry sweeper and operator replay safe to run at any time.
 */
export async function processStoredEvent(
  recordId: string,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const { data, error } = await supabase
    .from('webhook_events')
    .select('id, provider, event_id, event_type, event_data, status, attempts, processed, processed_at, last_error')
    .eq('id', recordId)
    .single();

  if (error || !data) {
    return { status: 'not_found', error: error?.message };
  }

  const record = data as StoredWebhookEvent;

  if (record.status === 'processed' && !options.force) {
    return { status: 'skipped' };
  }

  const handler = getWebhookHandler(record.provider, record.event_type);
  const attempts = record.attempts + 1;

  if (!handler) {
    // No handler registered is a successful no-op, not a failure to retry.
    logger.info('[webhook-ingest] No handler registered; marking processed', {
      provider: record.provider,
      eventType: record.event_type,
      eventId: record.event_id,
    });
    await markProcessed(record.id, attempts);
    return { status: 'processed' };
  }

  await supabase
    .from('webhook_events')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', record.id);

  try {
    await handler(record);
    await markProcessed(record.id, attempts);
    logger.info('[webhook-ingest] Event processed', {
      provider: record.provider,
      eventType: record.event_type,
      eventId: record.event_id,
      attempts,
    });
    return { status: 'processed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const exhausted = attempts >= MAX_ATTEMPTS;

    await supabase
      .from('webhook_events')
      .update({
        status: exhausted ? 'dead_letter' : 'failed',
        attempts,
        last_error: message,
        next_attempt_at: exhausted
          ? null
          : new Date(Date.now() + backoffMs(attempts)).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id);

    logger.error('[webhook-ingest] Handler failed', {
      provider: record.provider,
      eventType: record.event_type,
      eventId: record.event_id,
      attempts,
      exhausted,
      error: message,
    });

    return { status: exhausted ? 'dead_letter' : 'failed', error: message };
  }
}

async function markProcessed(recordId: string, attempts: number): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('webhook_events')
    .update({
      status: 'processed',
      processed: true,
      processed_at: now,
      attempts,
      last_error: null,
      next_attempt_at: null,
      updated_at: now,
    })
    .eq('id', recordId);
}

/**
 * Fire-and-forget hand-off used straight after acknowledgement.
 * Errors are swallowed on purpose — the record is durable and the sweeper will
 * retry it.
 */
export function dispatchStoredEvent(recordId: string): void {
  setImmediate(() => {
    processStoredEvent(recordId).catch((err) => {
      logger.error('[webhook-ingest] Async dispatch failed', {
        recordId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

// ─── Retry sweeper ───────────────────────────────────────────────────────────

/**
 * Re-run deliveries that are still pending or have failed and are due.
 *
 * This is what makes "the provider does not need to redeliver" true: a handler
 * outage is recovered from the stored record.
 */
export async function retryDueWebhookEvents(limit = 50): Promise<number> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('webhook_events')
    .select('id')
    .in('status', ['pending', 'failed'])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    logger.error('[webhook-ingest] Failed to list due events', { error: error.message });
    return 0;
  }

  const rows = (data ?? []) as Array<{ id: string }>;
  let processed = 0;
  for (const row of rows) {
    const result = await processStoredEvent(row.id);
    if (result.status === 'processed') processed++;
  }
  return processed;
}

// ─── Operator replay ─────────────────────────────────────────────────────────

export interface ReplayRequest {
  /** Stored event row id, or the provider/event-id pair. */
  recordId?: string;
  provider?: WebhookProvider;
  eventId?: string;
  requestedBy?: string;
  reason?: string;
}

export interface ReplayResult {
  status: ProcessResult['status'];
  recordId?: string;
  error?: string;
}

/**
 * Re-run a stored event on demand.
 *
 * Uses `force`, so replaying an already-processed event actually re-runs the
 * handler — which is only safe because handlers are required to be idempotent.
 */
export async function replayWebhookEvent(request: ReplayRequest): Promise<ReplayResult> {
  let recordId = request.recordId;

  if (!recordId) {
    if (!request.provider || !request.eventId) {
      return { status: 'not_found', error: 'recordId or provider + eventId is required' };
    }
    const { data, error } = await supabase
      .from('webhook_events')
      .select('id')
      .eq('provider', request.provider)
      .eq('event_id', request.eventId)
      .maybeSingle();

    if (error || !data) {
      return { status: 'not_found', error: error?.message ?? 'event not found' };
    }
    recordId = (data as { id: string }).id;
  }

  const result = await processStoredEvent(recordId, { force: true });

  try {
    await supabase.from('webhook_replays').insert({
      webhook_event_id: recordId,
      requested_by: request.requestedBy ?? null,
      reason: request.reason ?? null,
      outcome: result.status,
      error: result.error ?? null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn('[webhook-ingest] Failed to record replay audit row', {
      recordId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { status: result.status, recordId, error: result.error };
}
