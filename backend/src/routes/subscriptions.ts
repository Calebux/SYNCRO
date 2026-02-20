import { Router, Response } from 'express';
import { subscriptionService } from '../services/subscription-service';
import { idempotencyService } from '../services/idempotency';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validateSubscriptionOwnership, validateBulkSubscriptionOwnership } from '../middleware/ownership';
import logger from '../config/logger';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/subscriptions
 * List user's subscriptions with optional filtering
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, category, limit, offset } = req.query;

    const result = await subscriptionService.listSubscriptions(req.user!.id, {
      status: status as string | undefined,
      category: category as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });

    res.json({
      success: true,
      data: result.subscriptions,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      },
    });
  } catch (error) {
    logger.error('List subscriptions error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list subscriptions',
    });
  }
});

/**
 * GET /api/subscriptions/:id
 * Get single subscription by ID
 */
router.get('/:id', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscription = await subscriptionService.getSubscription(
      req.user!.id,
      req.params.id
    );

    res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    logger.error('Get subscription error:', error);
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get subscription',
    });
  }
});

/**
 * POST /api/subscriptions
 * Create new subscription with idempotency support
 */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    // Check idempotency if key provided
    if (idempotencyKey) {
      const idempotencyCheck = await idempotencyService.checkIdempotency(
        idempotencyKey,
        req.user!.id,
        requestHash
      );

      if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
        logger.info('Returning cached response for idempotent request', {
          idempotencyKey,
          userId: req.user!.id,
        });

        return res
          .status(idempotencyCheck.cachedResponse.status)
          .json(idempotencyCheck.cachedResponse.body);
      }
    }

    // Validate input
    const { name, price, billing_cycle } = req.body;
    if (!name || price === undefined || !billing_cycle) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, price, billing_cycle',
      });
    }

    // Create subscription
    const result = await subscriptionService.createSubscription(
      req.user!.id,
      req.body,
      idempotencyKey
    );

    const responseBody = {
      success: true,
      data: result.subscription,
      blockchain: {
        synced: result.syncStatus === 'synced',
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === 'failed' ? 207 : 201; // 207 = Multi-Status for partial success

    // Store idempotency record if key provided
    if (idempotencyKey) {
      await idempotencyService.storeResponse(
        idempotencyKey,
        req.user!.id,
        requestHash,
        statusCode,
        responseBody
      );
    }

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error('Create subscription error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create subscription',
    });
  }
});

/**
 * PATCH /api/subscriptions/:id
 * Update subscription with optimistic locking
 */
router.patch('/:id', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    const requestHash = idempotencyService.hashRequest(req.body);

    // Check idempotency if key provided
    if (idempotencyKey) {
      const idempotencyCheck = await idempotencyService.checkIdempotency(
        idempotencyKey,
        req.user!.id,
        requestHash
      );

      if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
        return res
          .status(idempotencyCheck.cachedResponse.status)
          .json(idempotencyCheck.cachedResponse.body);
      }
    }

    const expectedVersion = req.headers['if-match'] as string; // Optional optimistic locking

    const result = await subscriptionService.updateSubscription(
      req.user!.id,
      req.params.id,
      req.body,
      expectedVersion ? parseInt(expectedVersion) : undefined
    );

    const responseBody = {
      success: true,
      data: result.subscription,
      blockchain: {
        synced: result.syncStatus === 'synced',
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === 'failed' ? 207 : 200;

    // Store idempotency record if key provided
    if (idempotencyKey) {
      await idempotencyService.storeResponse(
        idempotencyKey,
        req.user!.id,
        requestHash,
        statusCode,
        responseBody
      );
    }

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error('Update subscription error:', error);
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update subscription',
    });
  }
});

/**
 * DELETE /api/subscriptions/:id
 * Delete subscription
 */
router.delete('/:id', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.deleteSubscription(
      req.user!.id,
      req.params.id
    );

    const responseBody = {
      success: true,
      message: 'Subscription deleted',
      blockchain: {
        synced: result.syncStatus === 'synced',
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    const statusCode = result.syncStatus === 'failed' ? 207 : 200;

    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error('Delete subscription error:', error);
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete subscription',
    });
  }
});

/**
 * POST /api/subscriptions/:id/retry-sync
 * Retry blockchain sync for a subscription
 */
router.post('/:id/retry-sync', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.retryBlockchainSync(
      req.user!.id,
      req.params.id
    );

    res.json({
      success: result.success,
      transactionHash: result.transactionHash,
      error: result.error,
    });
  } catch (error) {
    logger.error('Retry sync error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to retry sync',
    });
  }
});

/**
 * POST /api/subscriptions/:id/cancel
 * Cancel a subscription — marks it cancelled in DB + logs on-chain.
 *
 * Body (all optional):
 *   cancellation_url  — Merchant's own cancellation page to redirect the user to.
 *   reason            — Human-readable cancellation reason (appended to notes).
 *
 * Response:
 *   200 — Cancelled successfully, blockchain synced.
 *   207 — Cancelled in DB but blockchain log failed (partial success).
 *   404 — Subscription not found or not owned by authenticated user.
 *   409 — Subscription is already cancelled.
 *   500 — Unexpected server error.
 */
router.post('/:id/cancel', validateSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionService.cancelSubscription(
      req.user!.id,
      req.params.id,
      {
        cancellation_url: req.body.cancellation_url,
        reason: req.body.reason,
      }
    );

    const responseBody = {
      success: true,
      data: result.subscription,
      ...(result.cancellationUrl && { cancellationUrl: result.cancellationUrl }),
      blockchain: {
        synced: result.syncStatus === 'synced',
        transactionHash: result.blockchainResult?.transactionHash,
        error: result.blockchainResult?.error,
      },
    };

    // 207 Multi-Status when DB succeeded but chain logging failed
    const statusCode = result.syncStatus === 'failed' ? 207 : 200;
    res.status(statusCode).json(responseBody);
  } catch (error) {
    logger.error('Cancel subscription error:', error);

    if (error instanceof Error) {
      if (error.message.includes('not found') || error.message.includes('access denied')) {
        return res.status(404).json({ success: false, error: error.message });
      }
      if (error.message.includes('already cancelled')) {
        return res.status(409).json({ success: false, error: error.message });
      }
    }

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel subscription',
    });
  }
});

/**
 * POST /api/subscriptions/bulk
 * Bulk operations (delete, update status, etc.)
 */
router.post('/bulk', validateBulkSubscriptionOwnership, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { operation, ids, data } = req.body;

    if (!operation || !ids || !Array.isArray(ids)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: operation, ids',
      });
    }

    const results = [];
    const errors = [];

    // Process each subscription
    for (const id of ids) {
      try {
        let result;
        switch (operation) {
          case 'delete':
            result = await subscriptionService.deleteSubscription(req.user!.id, id);
            break;
          case 'update':
            if (!data) {
              throw new Error('Update data required');
            }
            result = await subscriptionService.updateSubscription(req.user!.id, id, data);
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
        results.push({ id, success: true, result });
      } catch (error) {
        errors.push({
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    res.json({
      success: errors.length === 0,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error('Bulk operation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to perform bulk operation',
    });
  }
});

export default router;
