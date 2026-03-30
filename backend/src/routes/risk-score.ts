/**
 * Risk Score API Routes
 */

import express, { Response } from 'express';
import { riskDetectionService } from '../services/risk-detection/risk-detection-service';
import { riskNotificationService } from '../services/risk-detection/risk-notification-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { adminAuth } from '../middleware/admin';
import logger from '../config/logger';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * @openapi
 * /api/risk-score/{subscriptionId}:
 *   get:
 *     tags: [Risk Score]
 *     summary: Get risk score for a subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Risk score data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/RiskScore' }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Risk score not found
 */
router.get('/:subscriptionId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    // Verify subscription belongs to user and get risk score
    const riskScore = await riskDetectionService.getRiskScore(
      Array.isArray(subscriptionId) ? subscriptionId[0] : subscriptionId,
      userId
    );

    return res.status(200).json({
      success: true,
      data: {
        subscription_id: riskScore.subscription_id,
        risk_level: riskScore.risk_level,
        risk_factors: riskScore.risk_factors,
        last_calculated_at: riskScore.last_calculated_at,
      },
    });
  } catch (error) {
    logger.error('Error fetching risk score:', error);

    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Risk score not found',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * @openapi
 * /api/risk-score:
 *   get:
 *     tags: [Risk Score]
 *     summary: Get all risk scores for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of risk scores
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/RiskScore' }
 *                 total: { type: integer }
 *       401:
 *         description: Unauthorized
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    const riskScores = await riskDetectionService.getUserRiskScores(userId);

    return res.status(200).json({
      success: true,
      data: riskScores.map(score => ({
        subscription_id: score.subscription_id,
        risk_level: score.risk_level,
        risk_factors: score.risk_factors,
        last_calculated_at: score.last_calculated_at,
      })),
      total: riskScores.length,
    });
  } catch (error) {
    logger.error('Error fetching user risk scores:', error);

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
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
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    logger.info('Manual risk recalculation triggered', { user_id: userId });

    const result = await riskDetectionService.recalculateAllRisks();

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error in manual risk recalculation:', error);

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * @openapi
 * /api/risk-score/{subscriptionId}/calculate:
 *   post:
 *     tags: [Risk Score]
 *     summary: Calculate risk for a specific subscription
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Calculated risk score
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/RiskScore' }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Subscription not found
 */
router.post('/:subscriptionId/calculate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    // Compute risk
    const assessment = await riskDetectionService.computeRiskLevel(
      Array.isArray(subscriptionId) ? subscriptionId[0] : subscriptionId
    );
    
    // Save risk score
    const riskScore = await riskDetectionService.saveRiskScore(assessment, userId);

    // Trigger notification if needed
    // Note: We need subscription details for notification
    // For now, we'll skip notification in this endpoint
    // In production, fetch subscription details and call notification service

    return res.status(200).json({
      success: true,
      data: {
        subscription_id: riskScore.subscription_id,
        risk_level: riskScore.risk_level,
        risk_factors: riskScore.risk_factors,
        last_calculated_at: riskScore.last_calculated_at,
      },
    });
  } catch (error) {
    logger.error('Error calculating risk score:', error);

    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
