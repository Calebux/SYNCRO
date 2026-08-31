import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { adminAuth } from '../middleware/admin';
import { renewalDeadLetterService } from '../services/renewal-dead-letter-service';
import logger from '../config/logger';

const router: Router = Router();

router.use(authenticate);

/**
 * GET /api/renewals/dead-letter
 * List renewal dead-letter entries for the authenticated user.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entries = await renewalDeadLetterService.getUserDeadLetters(req.user!.id);
    res.json({ success: true, data: entries });
  } catch (error) {
    logger.error('GET /api/renewals/dead-letter error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch renewal dead-letter entries',
    });
  }
});

/**
 * GET /api/renewals/dead-letter/stats
 * Admin-only aggregate DLQ statistics.
 */
router.get('/stats', adminAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await renewalDeadLetterService.getDeadLetterStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('GET /api/renewals/dead-letter/stats error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch renewal DLQ stats',
    });
  }
});

export default router;
