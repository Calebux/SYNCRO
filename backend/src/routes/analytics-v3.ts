import { Router, Response } from 'express';
import { analyticsV3Service } from '../services/analytics-v3-service';
import { AuthenticatedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import logger from '../config/logger';
import { AnalyticsPeriod, AnalyticsQueryParams } from '@syncro/shared/domain';

const router: Router = Router();

/**
 * Parse and validate query parameters for analytics period.
 * Defaults to last 30 days with day granularity.
 */
function parsePeriod(req: AuthenticatedRequest): AnalyticsPeriod {
  const query = req.query as unknown as AnalyticsQueryParams;
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const start = query.from ? new Date(query.from) : defaultStart;
  const end = query.to ? new Date(query.to) : now;
  const granularity = query.granularity ?? 'day';

  // Validate dates
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid date format. Use ISO-8601 (e.g., 2026-01-01T00:00:00Z)');
  }
  if (start > end) {
    throw new Error('Start date must be before end date');
  }
  if (end > now) {
    throw new Error('End date cannot be in the future');
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    granularity,
  };
}

/**
 * GET /api/analytics/v3/usage
 *
 * Principal-facing analytics: usage and settlement metrics for the
 * authenticated user's own data only.
 *
 * Authorization: Standard user authentication (authenticate middleware).
 * The userId is derived from the authenticated request — never from
 * query parameters — so cross-tenant leakage is impossible by design.
 */
router.get(
  '/usage',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const period = parsePeriod(req);
      const analytics = await analyticsV3Service.getPrincipalAnalytics(req.user!.id, period);

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      logger.error('Principal analytics error:', error);
      const status = error instanceof Error && error.message.includes('Invalid') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch principal analytics',
      });
    }
  }
);

/**
 * GET /api/analytics/v3/operator/usage
 *
 * Operator-facing analytics: aggregated usage and settlement metrics
 * across all principals.
 *
 * Authorization: Requires 'owner' or 'admin' role via RBAC middleware.
 * This endpoint MUST NOT be accessible to regular users.
 */
router.get(
  '/operator/usage',
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const period = parsePeriod(req);
      const analytics = await analyticsV3Service.getOperatorAnalytics(period);

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      logger.error('Operator analytics error:', error);
      const status = error instanceof Error && error.message.includes('Invalid') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch operator analytics',
      });
    }
  }
);

export default router;