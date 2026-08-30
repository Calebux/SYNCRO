import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { subscriptionDedupService } from '../services/subscription-dedup-service';
import logger from '../config/logger';

const router = Router();

// GET /api/subscriptions/duplicates - find all duplicates for user
router.get('/duplicates', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const candidates = await subscriptionDedupService.findDuplicates(userId);
    res.json({ duplicates: candidates });
  } catch (error) {
    logger.error('GET /duplicates error:', error);
    res.status(500).json({ error: 'Failed to find duplicates' });
  }
});

// POST /api/subscriptions/duplicates/merge - merge two subscriptions
router.post('/duplicates/merge', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { keepId, mergeId } = req.body;

    if (!keepId || !mergeId) {
      return res.status(400).json({ error: 'keepId and mergeId are required' });
    }
    if (keepId === mergeId) {
      return res.status(400).json({ error: 'keepId and mergeId must be different' });
    }

    const result = await subscriptionDedupService.mergeSubscriptions(userId, keepId, mergeId);
    res.json(result);
  } catch (error) {
    logger.error('POST /duplicates/merge error:', error);
    const message = error instanceof Error ? error.message : 'Failed to merge subscriptions';
    res.status(500).json({ error: message });
  }
});

// GET /api/subscriptions/duplicates/check - check if subscription is duplicate
// Query params: name, amount, billingCycle
router.get('/duplicates/check', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, amount, billingCycle } = req.query;

    if (!name || !amount || !billingCycle) {
      return res.status(400).json({ error: 'name, amount, and billingCycle query params are required' });
    }

    const parsedAmount = parseFloat(amount as string);
    if (isNaN(parsedAmount)) {
      return res.status(400).json({ error: 'amount must be a number' });
    }

    const candidate = await subscriptionDedupService.checkForDuplicate(
      userId,
      name as string,
      parsedAmount,
      billingCycle as string,
    );

    res.json({ duplicate: candidate });
  } catch (error) {
    logger.error('GET /duplicates/check error:', error);
    res.status(500).json({ error: 'Failed to check for duplicates' });
  }
});

// GET /api/subscriptions/dedup-thresholds - get user's thresholds
router.get('/dedup-thresholds', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const thresholds = await subscriptionDedupService.getUserThresholds(userId);
    res.json({ thresholds });
  } catch (error) {
    logger.error('GET /dedup-thresholds error:', error);
    res.status(500).json({ error: 'Failed to get thresholds' });
  }
});

// PUT /api/subscriptions/dedup-thresholds - update user's thresholds
router.put('/dedup-thresholds', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { min_confidence, name_similarity_weight, amount_tolerance_pct } = req.body;

    const thresholds: Record<string, number> = {};

    if (min_confidence !== undefined) {
      const val = Number(min_confidence);
      if (isNaN(val) || val < 0 || val > 100) {
        return res.status(400).json({ error: 'min_confidence must be between 0 and 100' });
      }
      thresholds.min_confidence = val;
    }

    if (name_similarity_weight !== undefined) {
      const val = Number(name_similarity_weight);
      if (isNaN(val) || val < 0 || val > 1) {
        return res.status(400).json({ error: 'name_similarity_weight must be between 0 and 1' });
      }
      thresholds.name_similarity_weight = val;
    }

    if (amount_tolerance_pct !== undefined) {
      const val = Number(amount_tolerance_pct);
      if (isNaN(val) || val < 0 || val > 1) {
        return res.status(400).json({ error: 'amount_tolerance_pct must be between 0 and 1' });
      }
      thresholds.amount_tolerance_pct = val;
    }

    await subscriptionDedupService.saveUserThresholds(userId, thresholds);
    const updated = await subscriptionDedupService.getUserThresholds(userId);
    res.json({ thresholds: updated });
  } catch (error) {
    logger.error('PUT /dedup-thresholds error:', error);
    res.status(500).json({ error: 'Failed to update thresholds' });
  }
});

export default router;
