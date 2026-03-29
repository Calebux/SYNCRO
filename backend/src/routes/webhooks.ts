import { Router, Response } from 'express';
import { z } from 'zod';
import { webhookService } from '../services/webhook-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import logger from '../config/logger';

const router = Router();

// All routes require authentication
router.use(authenticate);

const webhookEventSchema = z.enum([
  'subscription.renewal_due',
  'subscription.renewed',
  'subscription.renewal_failed',
  'subscription.cancelled',
  'subscription.risk_score_changed',
  'reminder.sent'
]);

const createWebhookSchema = z.object({
  url: z
    .string()
    .max(2000, 'URL must not exceed 2000 characters')
    .url('Must be a valid URL')
    .refine(
      (val) => { try { const { protocol } = new URL(val); return protocol === 'http:' || protocol === 'https:'; } catch { return false; } },
      { message: 'URL must use http or https protocol' }
    ),
  events: z.array(webhookEventSchema).min(1, 'At least one event type is required').max(6, 'Maximum 6 event types per webhook'),
  description: z.string().max(255, 'Description must not exceed 255 characters').optional(),
});

const updateWebhookSchema = z.object({
  url: z
    .string()
    .max(2000, 'URL must not exceed 2000 characters')
    .url('Must be a valid URL')
    .refine(
      (val) => { try { const { protocol } = new URL(val); return protocol === 'http:' || protocol === 'https:'; } catch { return false; } },
      { message: 'URL must use http or https protocol' }
    )
    .optional(),
  events: z.array(webhookEventSchema).min(1, 'At least one event type is required').max(6, 'Maximum 6 event types per webhook').optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(255, 'Description must not exceed 255 characters').optional(),
});


/**
 * POST /api/webhooks
 * Register a new webhook
 */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = createWebhookSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: validation.error.errors.map((e) => e.message).join(', '),
      });
    }

    const webhook = await webhookService.registerWebhook(req.user!.id, req.body);
    res.status(201).json({
      success: true,
      data: webhook,
    });
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
 * List all webhooks for the user
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const webhooks = await webhookService.listWebhooks(req.user!.id);
    res.json({
      success: true,
      data: webhooks,
    });
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
 * Update a webhook
 */
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = updateWebhookSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: validation.error.errors.map((e) => e.message).join(', '),
      });
    }

    const webhook = await webhookService.updateWebhook(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
      req.body
    );
    res.json({
      success: true,
      data: webhook,
    });
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
 * Delete a webhook
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await webhookService.deleteWebhook(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    );
    res.json({
      success: true,
      message: 'Webhook deleted',
    });
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
 * Trigger a test event
 */
router.post('/:id/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const delivery = await webhookService.triggerTestEvent(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    );
    res.json({
      success: true,
      data: delivery,
    });
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
 * Get delivery history for a webhook
 */
router.get('/:id/deliveries', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deliveries = await webhookService.getDeliveries(
      req.user!.id,
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    );
    res.json({
      success: true,
      data: deliveries,
    });
  } catch (error) {
    logger.error('Get deliveries error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch deliveries',
    });
  }
});

export default router;
