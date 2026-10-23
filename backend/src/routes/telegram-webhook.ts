/**
 * Telegram bot webhook.
 *
 * Mounted at /api/telegram, so the endpoint is POST /api/telegram/webhook.
 *
 * Routed through the shared ingestion pipeline (issue #1283). Telegram
 * redelivers an update until it receives a 2xx, so before this the same
 * `/start` could be applied repeatedly; deduplication is now by
 * (provider='telegram', event_id=update_id) like every other provider, and the
 * command logic lives in `services/telegram-update-handler` where the pipeline
 * can run it from the stored record and retry it.
 *
 * Secret-token verification is unchanged — it moved into
 * `verifyTelegramWebhook`, which still uses constant-time comparison
 * (issue #1069).
 */

import { Router, Request, Response } from 'express';
import logger from '../config/logger';
import { ingestWebhook, telegramAdapter } from '../services/webhook-ingestion';

const router: Router = Router();

/**
 * POST /api/telegram/webhook
 *
 * Telegram treats any non-2xx as "retry later". Because the update is durably
 * stored before we answer, a 2xx here is safe: our own sweeper retries the
 * handler. A failure to store is answered 503 so Telegram does redeliver.
 */
// VALIDATION_BYPASS: body is verified by the adapter's secret-token check.
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const outcome = await ingestWebhook(telegramAdapter, req);

    switch (outcome.kind) {
      case 'rejected':
        return res.sendStatus(outcome.status);

      case 'malformed':
        // Not a retryable condition — acknowledge so Telegram stops resending.
        logger.warn('[TelegramWebhook] Update carried no update_id', {
          reason: outcome.reason,
        });
        return res.status(200).json({ ok: true, ignored: true });

      case 'duplicate':
        return res.status(200).json({ ok: true, duplicate: true });

      case 'accepted':
        return res.status(200).json({ ok: true });

      case 'persistence_failed':
        return res.status(503).json({ ok: false });
    }
  } catch (error) {
    logger.error('[TelegramWebhook] Error processing webhook:', error);
    return res.status(503).json({ ok: false });
  }
});

/**
 * GET /api/telegram/webhook
 * Health check endpoint
 */
// VALIDATION_BYPASS: No request parameters needed
router.get('/webhook', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'Telegram webhook endpoint is active',
  });
});

export default router;
