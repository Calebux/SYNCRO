/**
 * Session management routes — issue #966
 * GET    /api/sessions          — list user's active sessions
 * DELETE /api/sessions/:id      — revoke a specific session
 * DELETE /api/sessions          — revoke all sessions (except the current one)
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { sessionService } from '../services/session-service';
import logger from '../config/logger';

const router = Router();

/**
 * GET /api/sessions
 * Returns all active sessions for the authenticated user.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const sessions = await sessionService.listActiveSessions(userId);
    return res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    logger.error('Error listing sessions:', error);
    return res.status(500).json({ success: false, error: 'Failed to list sessions' });
  }
});

/**
 * DELETE /api/sessions/:sessionId
 * Revoke a specific session belonging to the authenticated user.
 */
router.delete('/:sessionId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { sessionId } = req.params;

    await sessionService.revokeSession(userId, sessionId, 'manual');
    return res.status(200).json({ success: true, message: 'Session revoked' });
  } catch (error) {
    logger.error('Error revoking session:', error);
    return res.status(500).json({ success: false, error: 'Failed to revoke session' });
  }
});

/**
 * DELETE /api/sessions
 * Revoke ALL sessions for the authenticated user.
 * The caller's own current session is included — they will be signed out.
 */
router.delete('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await sessionService.invalidateAllSessions(userId, 'manual');
    return res.status(200).json({
      success: true,
      message: `All sessions revoked`,
      data: { revoked_count: result.count },
    });
  } catch (error) {
    logger.error('Error revoking all sessions:', error);
    return res.status(500).json({ success: false, error: 'Failed to revoke all sessions' });
  }
});

export default router;
