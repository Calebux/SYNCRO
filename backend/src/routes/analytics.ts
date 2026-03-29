import { Router, Response } from 'express';
import { analyticsService } from '../services/analytics-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import logger from '../config/logger';

const router = Router();

// All analytics routes require authentication
router.use(authenticate);

/**
 * GET /api/analytics/summary
 * Get spend analytics summary and trends
 */
router.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const summary = await analyticsService.getSummary(req.user!.id);
    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Analytics summary error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch analytics summary'
    });
  }
});

/**
 * GET /api/analytics/budgets
 * Get user budgets
 */
router.get('/budgets', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: budgets, error } = await (analyticsService as any).getUserBudgets(req.user!.id);
    if (error) throw error;
    res.json({ success: true, data: budgets });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch budgets' });
  }
});

export default router;
