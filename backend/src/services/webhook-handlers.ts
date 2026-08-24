/**
 * Handler registrations for the unified webhook ingestion pipeline (#1283).
 *
 * Every handler here **must be idempotent**. The pipeline calls them from the
 * stored record, the retry sweeper may re-run one whose failure happened after
 * a partial side effect, and operator replay re-runs them deliberately.
 *
 * A provider event type with no handler is a successful no-op: the delivery is
 * still verified, persisted, deduplicated and marked processed, so adding
 * behaviour later is a pure addition rather than a change to the ingest path.
 */

import logger from '../config/logger';
import { registerWebhookHandler, type StoredWebhookEvent } from './webhook-ingestion';
import { handleTelegramUpdate, type TelegramUpdate } from './telegram-update-handler';

/** Paystack `charge.success`. */
async function handlePaystackChargeSuccess(event: StoredWebhookEvent): Promise<void> {
  const data = (event.event_data as { data?: { reference?: string } } | null)?.data;
  logger.info('[PaystackWebhook] charge.success processed', {
    reference: data?.reference ?? event.event_id,
    attempts: event.attempts,
  });
  // TODO: Add payment processing logic here.
  // Whatever lands here must remain idempotent — it can be replayed by an
  // operator and re-run by the retry sweeper.
}

async function handleTelegramMessage(event: StoredWebhookEvent): Promise<void> {
  await handleTelegramUpdate(event.event_data as TelegramUpdate);
}

let registered = false;

/**
 * Register every handler. Idempotent so tests and repeated boots are safe.
 */
export function registerWebhookHandlers(): void {
  if (registered) return;
  registered = true;

  registerWebhookHandler('paystack', 'charge.success', handlePaystackChargeSuccess);

  registerWebhookHandler('telegram', 'message', handleTelegramMessage);
  registerWebhookHandler('telegram', 'edited_message', handleTelegramMessage);
}

/** Test hook. */
export function resetWebhookHandlerRegistration(): void {
  registered = false;
}
