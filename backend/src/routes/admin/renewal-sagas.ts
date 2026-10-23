import { Router, Response } from 'express';
import { adminAuth } from '../../middleware/admin';
import { AuthenticatedRequest } from '../../middleware/auth';
import { renewalSagaStateService } from '../../services/renewal-saga/renewal-saga-state-service';
import logger from '../../config/logger';

const router = Router();

/**
 * GET /api/admin/renewal-sagas
 * Every renewal saga currently in flight (pending/running/compensating),
 * with its current step and how long it's been there — so a saga that's
 * stuck is visible on the dashboard before it ever reaches the DLQ.
 */
router.get('/', adminAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const sagas = await renewalSagaStateService.listInFlight();

    res.json({
      success: true,
      data: sagas.map((saga) => ({
        attemptId: saga.attemptId,
        subscriptionId: saga.subscriptionId,
        userId: saga.userId,
        sagaStatus: saga.sagaStatus,
        currentStep: saga.currentStep,
        completedSteps: saga.completedSteps,
        ageMs: saga.ageMs,
        needsManualReconciliation: saga.needsManualReconciliation,
        workerId: saga.workerId,
      })),
    });
  } catch (error) {
    logger.error('[AdminRenewalSagas] Failed to list in-flight sagas', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;