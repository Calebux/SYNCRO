import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { referralService } from '../services/referral-service';
import logger from '../config/logger';
import { env } from '../config/env';

const router = Router();

/**
 * GET /api/referrals/code
 * Returns the authenticated user's referral code (generates one if missing).
 */
router.get('/code', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const code = await referralService.getOrCreateCode(req.user!.id);
    const link = `${env.FRONTEND_URL}/ref/${code}`;
    res.json({ referralCode: code, referralLink: link });
  } catch (error) {
    logger.error('Failed to get referral code', { error });
    res.status(500).json({ error: 'Failed to retrieve referral code' });
  }
});

/**
 * GET /api/referrals/stats
 * Returns referral count, conversions, and rewards earned.
 */
router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await referralService.getStats(req.user!.id);
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get referral stats', { error });
    res.status(500).json({ error: 'Failed to retrieve referral stats' });
  }
});

const validateSchema = z.object({
  referralCode: z.string().min(1),
  referredUserId: z.string().uuid(),
});

/**
 * POST /api/referrals/validate
 * Validates a referral code at signup and records the referral.
 * Body: { referralCode: string, referredUserId: string }
 */
router.post('/validate', validate(validateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = req.body;

  try {
    await referralService.validateAndRecord(parsed.referralCode, parsed.referredUserId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to validate referral', { error });
    res.status(500).json({ error: 'Failed to validate referral code' });
  }
});

export default router;
