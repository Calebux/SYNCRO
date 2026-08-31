import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { subscriptionShareService } from '../services/subscription-share-service';
import { createShareInviteSchema } from '../schemas/subscription-share';
import logger from '../config/logger';

const router: Router = Router();

/**
 * GET /api/subscriptions/share/:token
 * Public preview of a share invite (rate-limited at app level).
 */
router.get('/share/:token', async (req, res: Response) => {
  try {
    const preview = await subscriptionShareService.getInvitePreview(req.params.token);
    res.json({ success: true, data: preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid invite';
    const status = message.includes('expired') ? 410 : 404;
    res.status(status).json({ success: false, error: message });
  }
});

router.use(authenticate);

/**
 * POST /api/subscriptions/:id/share
 * Create a secure share invite for a subscription.
 */
router.post('/:id/share', validate(createShareInviteSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionShareService.createInvite(
      req.user!.id,
      req.params.id,
      req.body,
    );

    res.status(201).json({
      success: true,
      data: {
        id: result.invite.id,
        shareUrl: result.shareUrl,
        permissionLevel: result.invite.permission_level,
        expiresAt: result.invite.expires_at,
        maxUses: result.invite.max_uses >= 999999 ? 'unlimited' : result.invite.max_uses,
      },
    });
  } catch (error) {
    logger.error('POST /api/subscriptions/:id/share error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create share invite',
    });
  }
});

/**
 * POST /api/subscriptions/share/:token/accept
 * Accept a share invite (authenticated).
 */
router.post('/share/:token/accept', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionShareService.acceptInvite(req.params.token, req.user!.id);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('POST /api/subscriptions/share/:token/accept error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to accept invite',
    });
  }
});

/**
 * GET /api/subscriptions/:id/share
 * List pending share invites for a subscription.
 */
router.get('/:id/share', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invites = await subscriptionShareService.listPendingInvites(req.user!.id, req.params.id);
    res.json({ success: true, data: invites });
  } catch (error) {
    logger.error('GET /api/subscriptions/:id/share error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list share invites',
    });
  }
});

/**
 * DELETE /api/subscriptions/:id/share/:inviteId
 * Revoke a pending share invite.
 */
router.delete('/:id/share/:inviteId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await subscriptionShareService.revokeInvite(req.user!.id, req.params.inviteId);
    res.json({ success: true, message: 'Invite revoked' });
  } catch (error) {
    logger.error('DELETE /api/subscriptions/:id/share/:inviteId error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to revoke invite',
    });
  }
});

/**
 * GET /api/subscriptions/:id/share/audit
 * Audit log of invite usage for a subscription.
 */
router.get('/:id/share/audit', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const log = await subscriptionShareService.getAuditLog(req.user!.id, req.params.id);
    res.json({ success: true, data: log });
  } catch (error) {
    logger.error('GET /api/subscriptions/:id/share/audit error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch audit log',
    });
  }
});

export default router;
