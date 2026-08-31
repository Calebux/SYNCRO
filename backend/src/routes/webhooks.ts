import { Router, Response } from 'express';
import { webhookService } from '../services/webhook-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import logger from '../config/logger';
import { createWebhookSchema, updateWebhookSchema } from '../schemas/webhook';
import { uuidParamSchema } from '../schemas/common';

const router: Router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/webhooks
 */
router.post('/', requireRole('owner', 'admin'), validate(createWebhookSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const webhook = await webhookService.registerWebhook(req.user!.id, req.body);
    res.status(201).json({ success: true, data: webhook });
  } catch (error) {
    logger.error('Create webhook error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create webhook',
    });
  }
});

/**
 * GET /api/webhooks
 */
// VALIDATION_BYPASS: No request parameters needed
router.get('/', requireRole('owner', 'admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const webhooks = await webhookService.listWebhooks(req.user!.id);
    res.json({ success: true, data: webhooks });
  } catch (error) {
    logger.error('List webhooks error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list webhooks',
    });
  }
});

/**
 * PUT /api/webhooks/:id
 */
router.put('/:id', requireRole('owner', 'admin'), validate(uuidParamSchema, 'params'), validate(updateWebhookSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const webhook = await webhookService.updateWebhook(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
      req.body,
    );
    res.json({ success: true, data: webhook });
  } catch (error) {
    logger.error('Update webhook error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update webhook',
    });
  }
});

/**
 * DELETE /api/webhooks/:id
 */
router.delete('/:id', requireRole('owner', 'admin'), validate(uuidParamSchema, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    await webhookService.deleteWebhook(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );
    res.json({ success: true, message: 'Webhook deleted' });
  } catch (error) {
    logger.error('Delete webhook error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete webhook',
    });
  }
});

/**
 * POST /api/webhooks/:id/test
 */
router.post('/:id/test', requireRole('owner', 'admin'), validate(uuidParamSchema, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const delivery = await webhookService.triggerTestEvent(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );
    res.json({ success: true, data: delivery });
  } catch (error) {
    logger.error('Test webhook error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to trigger test event',
    });
  }
});

/**
 * GET /api/webhooks/:id/deliveries
 */
router.get('/:id/deliveries', requireRole('owner', 'admin'), validate(uuidParamSchema, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deliveries = await webhookService.getDeliveries(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );
    res.json({ success: true, data: deliveries });
  } catch (error) {
    logger.error('Get deliveries error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch deliveries',
    });
  }
});

/**
 * GET /api/webhooks/dead-letter/all
 * Get all dead-letter deliveries for the user
 */
router.get('/dead-letter/all', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deadLetters = await webhookService.getAllUserDeadLetters(req.user!.id);
    res.json({ success: true, data: deadLetters });
  } catch (error) {
    logger.error('Get all dead-letter deliveries error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch dead-letter deliveries',
    });
  }
});

/**
 * GET /api/webhooks/:id/dead-letter
 * Get dead-letter deliveries for a specific webhook
 */
router.get('/:id/dead-letter', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deadLetters = await webhookService.getDeadLetterDeliveries(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );
    res.json({ success: true, data: deadLetters });
  } catch (error) {
    logger.error('Get dead-letter deliveries error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch dead-letter deliveries',
    });
  }
});

/**
 * GET /api/webhooks/dead-letter/stats
 * Get dead-letter statistics for the user
 */
router.get('/dead-letter/stats', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await webhookService.getDeadLetterStats(req.user!.id);
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Get dead-letter stats error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch dead-letter stats',
    });
  }
});

/**
 * POST /api/webhooks/:deliveryId/dead-letter/replay
 * Create a replay request for a dead-letter delivery
 */
router.post('/:deliveryId/dead-letter/replay', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { idempotency_key } = req.body;
    const deliveryId = Array.isArray(req.params.deliveryId) ? req.params.deliveryId[0] : req.params.deliveryId;
    
    const replay = await webhookService.createDeadLetterReplay(
      req.user!.id,
      deliveryId,
      idempotency_key,
    );
    res.status(201).json({ success: true, data: replay });
  } catch (error) {
    logger.error('Create replay request error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create replay request',
    });
  }
});

/**
 * GET /api/webhooks/:deliveryId/dead-letter/replay-history
 * Get replay history for a dead-letter delivery
 */
router.get('/:deliveryId/dead-letter/replay-history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deliveryId = Array.isArray(req.params.deliveryId) ? req.params.deliveryId[0] : req.params.deliveryId;
    const history = await webhookService.getDeadLetterReplayHistory(req.user!.id, deliveryId);
    res.json({ success: true, data: history });
  } catch (error) {
    logger.error('Get replay history error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch replay history',
    });
  }
});

/**
 * POST /api/webhooks/dead-letter/replay/:replayId/execute
 * Execute a replay for a dead-letter delivery
 */
router.post('/dead-letter/replay/:replayId/execute', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const replayId = Array.isArray(req.params.replayId) ? req.params.replayId[0] : req.params.replayId;
    const result = await webhookService.executeDeadLetterReplay(req.user!.id, replayId);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Execute replay error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute replay',
    });
  }
});

export default router;
