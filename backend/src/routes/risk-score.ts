import express, { Response } from 'express';
import { z } from 'zod';
import { riskDetectionService } from '../services/risk-detection/risk-detection-service';
import { AuthenticatedRequest } from '../middleware/auth';
import { adminAuth } from '../middleware/admin';
import { validate } from '../middleware/validate';

const router: express.Router = express.Router();

const keyOrSubscriptionParamSchema = z.object({
  id: z.string().min(1),
});

const actionConfigSchema = z.object({
  highRiskAction: z.enum(['warn', 'throttle', 'require_reauthorization']).optional(),
  mediumRiskAction: z.enum(['warn', 'throttle', 'require_reauthorization', 'none']).optional(),
  notifyPrincipal: z.boolean().optional(),
});

const evaluateAgentRiskSchema = z.object({
  keyId: z.string().min(1),
  agentId: z.string().optional(),
  provider: z.string().optional(),
  route: z.string().optional(),
  callCostUsd: z.number().optional(),
  recentCallRateCount: z.number().optional(),
  baselineCallRateCount: z.number().optional(),
  recentSpendUsd: z.number().optional(),
  spendCapUsd: z.number().optional(),
  historicalRoutes: z.array(z.string()).optional(),
  knownProviders: z.array(z.string()).optional(),
  lastKeyActivityAt: z.string().optional(),
  dormantDays: z.number().optional(),
});

/**
 * GET /api/risk-score/config
 * Get current risk action policy configuration
 */
router.get('/config', async (_req: express.Request, res: Response) => {
  const config = riskDetectionService.getActionPolicy();
  res.json({
    success: true,
    data: config,
  });
});

/**
 * POST /api/risk-score/config
 * Update risk action policy configuration
 */
router.post('/config', validate(actionConfigSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  const updatedPolicy = riskDetectionService.updateActionPolicy(req.body);
  res.json({
    success: true,
    data: updatedPolicy,
  });
});

/**
 * POST /api/risk-score/evaluate-async
 * Trigger risk evaluation off the synchronous admission path
 */
router.post('/evaluate-async', validate(evaluateAgentRiskSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id || 'system';
  const context = {
    ...req.body,
    userId,
  };

  // Run evaluation asynchronously without blocking request response
  riskDetectionService.evaluateAgentRiskAsync(context);

  res.status(202).json({
    success: true,
    message: 'Agent risk check queued asynchronously off the admission path',
  });
});

/**
 * POST /api/risk-score/evaluate
 * Trigger synchronous agent spend risk calculation
 */
router.post('/evaluate', validate(evaluateAgentRiskSchema, 'body'), async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id || 'system';
  const context = {
    ...req.body,
    userId,
  };

  const assessment = await riskDetectionService.evaluateAgentRisk(context);

  res.json({
    success: true,
    data: assessment,
  });
});

/**
 * GET /api/risk-score
 * List risk scores for authenticated user
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id || 'system';
  const riskScores = await riskDetectionService.getUserRiskScores(userId);

  res.json({
    success: true,
    data: riskScores.map((score) => ({
      id: score.id,
      key_id: score.key_id || score.subscription_id,
      subscription_id: score.subscription_id,
      risk_level: score.risk_level,
      action_taken: score.action_taken || 'none',
      risk_factors: score.risk_factors,
      last_calculated_at: score.last_calculated_at,
    })),
    total: riskScores.length,
  });
});

/**
 * POST /api/risk-score/recalculate
 * Trigger batch recalculation of all risk scores
 */
router.post('/recalculate', adminAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const result = await riskDetectionService.recalculateAllRisks();

  res.json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/risk-score/:id
 * Get risk score for a specific key or subscription ID
 */
router.get('/:id', validate(keyOrSubscriptionParamSchema, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id || 'system';

  const riskScore = await riskDetectionService.getRiskScore(id, userId);

  res.json({
    success: true,
    data: {
      id: riskScore.id,
      key_id: riskScore.key_id || riskScore.subscription_id,
      subscription_id: riskScore.subscription_id,
      risk_level: riskScore.risk_level,
      action_taken: riskScore.action_taken || 'none',
      risk_factors: riskScore.risk_factors,
      last_calculated_at: riskScore.last_calculated_at,
    },
  });
});

/**
 * POST /api/risk-score/:id/calculate
 * Calculate risk score for a specific key or subscription ID
 */
router.post('/:id/calculate', validate(keyOrSubscriptionParamSchema, 'params'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id || 'system';

  const assessment = await riskDetectionService.evaluateAgentRisk({
    keyId: id,
    userId,
  });

  res.json({
    success: true,
    data: assessment,
  });
});

export default router;
