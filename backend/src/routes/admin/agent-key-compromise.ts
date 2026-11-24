import { Router, Response } from 'express';
import { z } from 'zod';
import { adminAuth } from '../../middleware/admin';
import { AuthenticatedRequest } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { agentKeyCompromiseService } from '../../services/agent-key-compromise-service';
import logger from '../../config/logger';

const router = Router();

const apiKeyParamSchema = z.object({
  id: z.string().uuid(),
});

const evaluateSchema = z.object({
  spendVelocityPerMinute: z.number().nonnegative(),
  baselineVelocityPerMinute: z.number().nonnegative(),
  isNewNetworkOrigin: z.boolean(),
  routeMixShiftPercent: z.number().min(0).max(100),
  dormantDays: z.number().nonnegative(),
});

const respondSchema = z.object({
  reason: z.string().min(3).max(500).default('Automated key compromise response'),
});

router.post(
  '/:id/compromise/evaluate',
  adminAuth,
  validate(apiKeyParamSchema, 'params'),
  validate(evaluateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    const result = agentKeyCompromiseService.evaluateSignals(req.body);
    return res.json({
      success: true,
      data: result,
    });
  },
);

router.post(
  '/:id/compromise/respond',
  adminAuth,
  validate(apiKeyParamSchema, 'params'),
  validate(respondSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await agentKeyCompromiseService.containCompromisedKey(
        req.params.id,
        req.body.reason,
      );
      return res.json({
        success: true,
        message: 'Compromised key contained with a single action',
        data: result,
      });
    } catch (error) {
      logger.error('Compromised key response failed', error);
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Containment failed',
      });
    }
  },
);

export default router;
