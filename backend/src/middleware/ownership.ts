import { Response, NextFunction } from 'express';
import { supabase, databaseRepository } from '../config/database';
import { AuthenticatedRequest } from './auth';
import logger from '../config/logger';

/**
 * Middleware to validate subscription ownership
 * Must be used after authenticate middleware
 */
export async function validateSubscriptionOwnership(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const subscriptionId = req.params.id || req.body.subscriptionId || req.body.id;

    if (!subscriptionId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Subscription ID required',
      });
      return;
    }

    // Check ownership in database
    const { data: subscription, error } = await databaseRepository
      .from('subscriptions')
      .select('id, user_id')
      .eq('id', subscriptionId)
      .eq('user_id', req.user.id)
      .single();

    if (error || !subscription) {
      logger.warn('Subscription ownership validation failed', {
        subscriptionId,
        userId: req.user.id,
        error: error?.message,
      });

      res.status(403).json({
        error: 'Forbidden',
        message: 'Subscription not found or access denied',
      });
      return;
    }

    // Attach subscription to request for use in handlers
    (req as any).subscription = subscription;

    next();
  } catch (error) {
    logger.error('Ownership validation error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to validate ownership',
    });
  }
}

/**
 * Validate ownership for multiple subscriptions (bulk operations)
 */
export async function validateBulkSubscriptionOwnership(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    const subscriptionIds = req.body.ids || req.body.subscriptionIds || [];

    if (!Array.isArray(subscriptionIds) || subscriptionIds.length === 0) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Subscription IDs array required',
      });
      return;
    }

    // Check ownership for all subscriptions
    const { data: subscriptions, error } = await databaseRepository
      .from('subscriptions')
      .select('id, user_id')
      .in('id', subscriptionIds)
      .eq('user_id', req.user.id);

    if (error) {
      logger.error('Bulk ownership validation error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to validate ownership',
      });
      return;
    }

    const foundIds = subscriptions?.map((s) => s.id) || [];
    const missingIds = subscriptionIds.filter((id) => !foundIds.includes(id));

    if (missingIds.length > 0) {
      logger.warn('Some subscriptions not found or access denied', {
        missingIds,
        userId: req.user.id,
      });

      res.status(403).json({
        error: 'Forbidden',
        message: 'Some subscriptions not found or access denied',
        missingIds,
      });
      return;
    }

    // Attach validated subscriptions to request
    (req as any).validatedSubscriptions = subscriptions;

    next();
  } catch (error) {
    logger.error('Bulk ownership validation error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to validate ownership',
    });
  }
}
