/**
 * Risk Score API Routes
 */

import express, { Response } from 'express';
import { riskDetectionService } from '../services/risk-detection/risk-detection-service';
import { riskNotificationService } from '../services/risk-detection/risk-notification-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import logger from '../config/logger';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

/**
 * GET /api/risk-score/:subscriptionId
 * Get risk score for a specific subscription
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
 * GET /api/risk-score
 * Get all risk scores for authenticated user
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
 * POST /api/risk-score/recalculate
 * Manually trigger risk recalculation for all subscriptions
 * Note: In production, this should be admin-only
 */
router.post('/recalculate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    // TODO: Add admin check
    // For now, allow any authenticated user to trigger recalculation

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
 * POST /api/risk-score/:subscriptionId/calculate
 * Calculate risk for a specific subscription
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
