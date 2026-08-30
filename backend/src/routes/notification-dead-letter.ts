import { Router, Response } from 'express';
import { notificationDeadLetterService } from '../services/notification-dead-letter-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import logger from '../config/logger';

const router: Router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/notifications/dead-letter
 * Get all dead-letter entries for the user
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deadLetters = await notificationDeadLetterService.getUserDeadLetters(req.user!.id);
    res.json({ success: true, data: deadLetters });
  } catch (error) {
    logger.error('Get dead-letter notifications error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch dead-letter notifications',
    });
  }
});

/**
 * GET /api/notifications/dead-letter/stats
 * Get dead-letter statistics for the user
 */
router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await notificationDeadLetterService.getDeadLetterStats(req.user!.id);
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
 * GET /api/notifications/dead-letter/:dlqId
 * Get a specific dead-letter entry
 */
router.get('/:dlqId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dlqId = Array.isArray(req.params.dlqId) ? req.params.dlqId[0] : req.params.dlqId;
    const entry = await notificationDeadLetterService.getDeadLetterEntry(req.user!.id, dlqId);
    res.json({ success: true, data: entry });
  } catch (error) {
    logger.error('Get dead-letter entry error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch dead-letter entry',
    });
  }
});

/**
 * POST /api/notifications/dead-letter/:dlqId/replay
 * Create a replay request for a dead-letter notification
 */
router.post('/:dlqId/replay', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { idempotency_key } = req.body;
    const dlqId = Array.isArray(req.params.dlqId) ? req.params.dlqId[0] : req.params.dlqId;

    const replay = await notificationDeadLetterService.createReplayRequest(
      dlqId,
      req.user!.id,
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
 * GET /api/notifications/dead-letter/:dlqId/replay-history
 * Get replay history for a dead-letter notification
 */
router.get('/:dlqId/replay-history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dlqId = Array.isArray(req.params.dlqId) ? req.params.dlqId[0] : req.params.dlqId;
    const history = await notificationDeadLetterService.getReplayHistory(req.user!.id, dlqId);
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
 * POST /api/notifications/dead-letter/replay/:replayId/execute
 * Execute a replay for a dead-letter notification
 */
router.post('/replay/:replayId/execute', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const replayId = Array.isArray(req.params.replayId) ? req.params.replayId[0] : req.params.replayId;
    const result = await notificationDeadLetterService.executeReplay(replayId);
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
