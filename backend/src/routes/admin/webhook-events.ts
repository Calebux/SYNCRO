/**
 * Operator tooling for inbound webhook events (issue #1283).
 *
 * Mounted at /api/admin/webhook-events.
 *
 * Replay re-runs a stored event through its handler. That is only safe because
 * handlers are required to be idempotent, and every replay is recorded in
 * `webhook_replays` with the operator who asked for it.
 */

import { Router, Response } from 'express';
import { supabase } from '../../config/database';
import logger from '../../config/logger';
import { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { replayWebhookEvent, retryDueWebhookEvents } from '../../services/webhook-ingestion';
import {
  replayWebhookBodySchema,
  listWebhookEventsQuerySchema,
  type ReplayWebhookBody,
  type ListWebhookEventsQuery,
} from '../../schemas/webhook-replay';

const router: Router = Router();

router.use(requireRole('owner', 'admin'));

/**
 * GET /api/admin/webhook-events
 * Inspect stored deliveries, newest first.
 */
router.get(
  '/',
  validate(listWebhookEventsQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { provider, status, limit } = req.query as unknown as ListWebhookEventsQuery;

    let query = supabase
      .from('webhook_events')
      .select('id, provider, event_id, event_type, status, attempts, last_error, created_at, processed_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (provider) query = query.eq('provider', provider);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) {
      logger.error('[admin] Failed to list webhook events', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to list webhook events' });
    }

    return res.json({ success: true, data: data ?? [] });
  },
);

/**
 * POST /api/admin/webhook-events/replay
 * Re-run a stored event. Handlers are idempotent, so this is safe to repeat.
 */
router.post(
  '/replay',
  validate(replayWebhookBodySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as ReplayWebhookBody;

    const result = await replayWebhookEvent({
      recordId: body.recordId,
      provider: body.provider,
      eventId: body.eventId,
      reason: body.reason,
      requestedBy: req.user!.id,
    });

    if (result.status === 'not_found') {
      return res.status(404).json({ success: false, error: result.error ?? 'Event not found' });
    }

    logger.info('[admin] Webhook event replayed', {
      recordId: result.recordId,
      outcome: result.status,
      requestedBy: req.user!.id,
    });

    return res.json({ success: true, data: result });
  },
);

/**
 * POST /api/admin/webhook-events/retry-due
 * Run the retry sweep immediately instead of waiting for the cron tick.
 */
// VALIDATION_BYPASS: No request parameters needed
router.post('/retry-due', async (req: AuthenticatedRequest, res: Response) => {
  const processed = await retryDueWebhookEvents();
  logger.info('[admin] Manual webhook retry sweep', {
    processed,
    requestedBy: req.user!.id,
  });
  return res.json({ success: true, data: { processed } });
});

export default router;
