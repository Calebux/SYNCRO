/**
 * Shared route factory for inbound provider webhooks (issue #1283).
 *
 * Every provider endpoint is this same handler with a different adapter. The
 * response mapping is the pipeline's contract with the provider:
 *
 *   - 4xx  verification failed or the event carried no id — do not retry
 *   - 200  duplicate delivery, already accepted
 *   - 202  accepted and durably stored; processing continues asynchronously
 *   - 503  not persisted — the provider *should* retry
 */

import { Router, Request, Response } from 'express';
import logger from '../config/logger';
import { ingestWebhook, type ProviderAdapter } from '../services/webhook-ingestion';

export function createWebhookIngestRouter(adapter: ProviderAdapter): Router {
  const router: Router = Router();

  // VALIDATION_BYPASS: the body is provider-signed and verified by the adapter;
  // schema validation would run before verification and on unauthenticated input.
  router.post('/', async (req: Request, res: Response) => {
    try {
      const outcome = await ingestWebhook(adapter, req);

      switch (outcome.kind) {
        // The detailed reason is logged and written to webhook_rejections, but
        // never returned: it comes from an unauthenticated caller's failed
        // verification and can describe our own configuration.
        case 'rejected':
          return res.status(outcome.status).json({ error: adapter.rejectionMessage });

        case 'malformed':
          return res
            .status(outcome.status)
            .json({ error: 'Webhook payload is missing an event id' });

        case 'duplicate':
          return res.status(outcome.status).json({
            received: true,
            duplicate: true,
            eventId: outcome.eventId,
          });

        case 'accepted':
          return res.status(outcome.status).json({
            received: true,
            eventId: outcome.eventId,
          });

        case 'persistence_failed':
          // Deliberately not acknowledged: the provider must redeliver.
          return res.status(outcome.status).json({
            error: 'Failed to durably store the event; please retry',
          });
      }
    } catch (err) {
      logger.error('[webhook-ingest] Unhandled ingestion error', {
        provider: adapter.provider,
        error: err instanceof Error ? err.message : String(err),
      });
      // Unacknowledged on purpose — an unknown failure must not swallow an event.
      return res.status(503).json({ error: 'Webhook ingestion failed; please retry' });
    }
  });

  return router;
}
