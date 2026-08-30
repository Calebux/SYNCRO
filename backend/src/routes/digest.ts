import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { adminAuth } from '../middleware/admin';
import { digestService } from '../services/digest-service';
import { digestEmailService } from '../services/digest-email-service';
import logger from '../config/logger';
import { updateDigestPreferencesSchema } from '../schemas/digest';

const router: Router = Router();

// ─── User-facing routes (authenticated) ──────────────────────────────────────
router.use(authenticate);

const updateDigestPreferencesSchema = z.object({
  digestEnabled: z.boolean().optional(),
  digestDay: z.number().int().min(1).max(28).optional(),
  includeYearToDate: z.boolean().optional(),
});

/**
 * GET /api/digest/preferences
 * Get digest preferences
 */
router.get('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  const prefs = await digestService.getDigestPreferences(req.user!.id);
  res.json({ success: true, data: prefs });
});

/**
 * PATCH /api/digest/preferences
 * Update digest settings (opt-in, digest day, year-to-date toggle).
 */
router.patch(
  '/preferences',
  validate(updateDigestPreferencesSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { digestEnabled, digestDay, includeYearToDate } = req.body;

      const updated = await digestService.updateDigestPreferences(userId, {
        ...(digestEnabled !== undefined && { digestEnabled }),
        ...(digestDay !== undefined && { digestDay }),
        ...(includeYearToDate !== undefined && { includeYearToDate }),
      });

      return res.json({ success: true, data: updated });
    } catch (err) {
      logger.error('PATCH /digest/preferences error:', err);
      return res.status(500).json({ success: false, error: 'Failed to update preferences' });
    }
  },
);

/**
 * POST /api/digest/test
 * Send a test digest email (rate-limited to 1/hour)
 */
router.post('/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const history = await digestEmailService.getAuditHistory(userId, 5);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentTests = history.filter(
      (h) => h.digestType === 'test' && new Date(h.sentAt).getTime() > oneHourAgo,
    );

    if (recentTests.length > 0) {
      return res.status(429).json({
        success: false,
        error: 'A test digest was already sent in the last hour. Please try again later.',
      });
    }

    const outcome = await digestService.sendDigestForUser(userId, 'test');

    if (!outcome.success) {
      return res.status(500).json({ success: false, error: outcome.error });
    }

    return res.json({ success: true, message: 'Test digest sent successfully.' });
  } catch (err) {
    logger.error('POST /digest/test error:', err);
    return res.status(500).json({ success: false, error: 'Failed to send test digest' });
  }
});

/**
 * GET /api/digest/history
 * Get digest send history (last 24 records)
 */
router.get('/history', async (req: AuthenticatedRequest, res: Response) => {
  const history = await digestEmailService.getAuditHistory(req.user!.id);
  res.json({ success: true, data: history });
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

router.post('/admin/run', adminAuth, async (_req, res: Response) => {
  const result = await digestService.runMonthlyDigest();
  res.json({ success: true, data: result });
});

export default router;