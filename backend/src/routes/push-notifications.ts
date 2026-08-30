import { Router, Request, Response } from 'express';
import { supabase } from '../config/database';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import logger from '../config/logger';
import { pushSubscribeSchema } from '../schemas/push-notification';
import { enqueueNotification } from '../jobs/notification-queue';

const router: Router = Router();

router.use(authenticate);

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().optional(),
});

/**
 * POST /api/notifications/push/subscribe
 * Save a browser push subscription
 */
router.post('/subscribe', validate(pushSubscribeSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { endpoint, keys, userAgent } = req.body;

    const { data, error } = await supabase.from('push_subscriptions').insert({
      user_id: userId,
      endpoint,
      keys,
      user_agent: userAgent,
    }).select().single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data: { id: data.id, endpoint: data.endpoint, createdAt: data.created_at },
    });
  } catch (error) {
    logger.error('Push subscription error:', error);
    res.status(500).json({ success: false, error: 'Failed to subscribe to push notifications' });
  }
});

/**
 * DELETE /api/notifications/push/unsubscribe
 * Remove a push subscription
 */
router.delete('/unsubscribe', async (req: AuthenticatedRequest, res: Response) => {
  const { endpoint } = req.body as { endpoint?: string };
  const userId = req.user!.id;

  let query = supabase.from('push_subscriptions').delete().eq('user_id', userId);
  if (endpoint && typeof endpoint === 'string') {
    query = query.eq('endpoint', endpoint);
  }

  const { error } = await query;
  if (error) throw error;

  res.json({ success: true });
});

/**
 * GET /api/notifications/push/status
 */
router.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user!.id);

  if (error) throw error;

  res.json({ success: true, data: { subscribed: (count ?? 0) > 0, count: count ?? 0 } });
});

/**
 * GET /api/notifications/push/status
 * Check if user has an active push subscription
 */
router.get('/vapid-public-key', (req: Request, res: Response) => {
  try {
    const { pushService } = require('../services/push-service');
    const publicKey = pushService.getVapidPublicKey();
    return res.json({ success: true, data: { publicKey } });
  } catch (err) {
    logger.error('VAPID public key error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/notifications/push/vapid-public-key:
 *   get:
 *     tags: [Push Notifications]
 *     summary: Get the VAPID public key for push subscriptions
 *     responses:
 *       200:
 *         description: VAPID public key
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     publicKey: { type: string }
 */
router.get('/vapid-public-key', (req: Request, res: Response) => {
  try {
    const { pushService } = require('../services/push-service');
    const publicKey = pushService.getVapidPublicKey();
    return res.json({ success: true, data: { publicKey } });
  } catch (err) {
    logger.error('VAPID public key error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;