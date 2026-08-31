import express, { Response } from 'express';
import { z } from 'zod';
import { riskDetectionService } from '../services/risk-detection/risk-detection-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { adminAuth } from '../middleware/admin';
import { validate } from '../middleware/validate';

const router: express.Router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

const subscriptionParamSchema = z.object({
  subscriptionId: z.string().uuid(),
});

/**
 * GET /api/risk-score/:subscriptionId
 */
router.get('/:subscriptionId', validate(subscriptionParamSchema, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  const { subscriptionId } = req.params;
  const userId = req.user!.id;

  const riskScore = await riskDetectionService.getRiskScore(subscriptionId, userId);

  res.json({
    success: true,
    data: {
      subscription_id: riskScore.subscription_id,
      risk_level: riskScore.risk_level,
      risk_factors: riskScore.risk_factors,
      last_calculated_at: riskScore.last_calculated_at,
    },
  });
});

/**
 * GET /api/risk-score
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const riskScores = await riskDetectionService.getUserRiskScores(userId);

  res.json({
    success: true,
    data: riskScores.map(score => ({
      subscription_id: score.subscription_id,
      risk_level: score.risk_level,
      risk_factors: score.risk_factors,
      last_calculated_at: score.last_calculated_at,
    })),
    total: riskScores.length,
  });
});

/**
 * @openapi
 * /api/risk-score/recalculate:
 *   post:
 *     tags: [Risk Score]
 *     summary: Trigger risk recalculation for all subscriptions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recalculation result
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.post('/recalculate', adminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const result = await riskDetectionService.recalculateAllRisks();

  res.json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/risk-score/:subscriptionId/calculate
 */
router.post('/:subscriptionId/calculate', validate(subscriptionParamSchema, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  const { subscriptionId } = req.params;
  const userId = req.user!.id;

  const assessment = await riskDetectionService.computeRiskLevel(subscriptionId);
  const riskScore = await riskDetectionService.saveRiskScore(assessment, userId);

  res.json({
    success: true,
    data: {
      subscription_id: riskScore.subscription_id,
      risk_level: riskScore.risk_level,
      risk_factors: riskScore.risk_factors,
      last_calculated_at: riskScore.last_calculated_at,
    },
  });
});

export default router;
