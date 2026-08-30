import cron, { type ScheduledTask } from 'node-cron';
import logger from '../config/logger';
import { runWithCorrelationId } from '../middleware/requestContext';
import { retryDueWebhookEvents } from '../services/webhook-ingestion';

let webhookRetryTask: ScheduledTask | null = null;

/**
 * Retry inbound webhook events whose handler failed (issue #1283).
 *
 * This is what makes "a handler failure does not require the provider to
 * redeliver" true: the delivery was persisted and acknowledged, so recovery is
 * ours to do. Runs every minute; `processStoredEvent` skips anything already
 * processed, so overlapping ticks are harmless.
 */
export function startWebhookRetryJob(): void {
  webhookRetryTask = cron.schedule('* * * * *', () =>
    runWithCorrelationId('cron:webhook-retry', async (cid) => {
      try {
        const processed = await retryDueWebhookEvents();
        if (processed > 0) {
          logger.info('Webhook retry sweep processed events', {
            correlationId: cid,
            processed,
          });
        }
      } catch (err) {
        logger.error('Webhook retry sweep failed', {
          correlationId: cid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

export function stopWebhookRetryJob(): void {
  webhookRetryTask?.stop();
  webhookRetryTask = null;
}
