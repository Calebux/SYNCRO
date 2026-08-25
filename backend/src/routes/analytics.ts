import { Router, Response } from 'express';
import { analyticsService } from '../services/analytics-service';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import logger from '../config/logger';

const router: Router = Router();

// All analytics routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /api/analytics/summary:
 *   get:
 *     summary: Get spend analytics summary and trends
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Analytics summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     total_monthly_spend:
 *                       type: number
 *                       example: 89.97
 *                     active_subscriptions:
 *                       type: integer
 *                       example: 5
 *                     upcoming_renewals_count:
 *                       type: integer
 *                       example: 2
 *                     monthly_trend:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/MonthlySpend'
 *                     category_breakdown:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/CategorySpend'
 *                     top_subscriptions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/SubscriptionSpend'
 *                     budget_status:
 *                       type: object
 *                       properties:
 *                         overall_limit:
 *                           type: number
 *                           nullable: true
 *                         current_spend:
 *                           type: number
 *                         percentage:
 *                           type: number
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @swagger
 * /api/analytics/budgets:
 *   get:
 *     summary: Get user monthly budgets
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of budgets for the authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       user_id:
 *                         type: string
 *                         format: uuid
 *                       category:
 *                         type: string
 *                         nullable: true
 *                       budget_limit:
 *                         type: number
 *                         example: 200.00
 *                       alert_threshold:
 *                         type: number
 *                         example: 80
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/budgets', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: budgets, error } = await analyticsService.getUserBudgets(req.user!.id);
    if (error) throw error;
    res.json({ success: true, data: budgets });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch budgets' });
  }
});

/**
 * @swagger
 * /api/analytics/spending:
 *   get:
 *     summary: Get spending trends for the authenticated user
 *     description: Returns current month spend, 6-month historical trend, and category breakdown derived from active subscriptions.
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Spending data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     current_month_spend:
 *                       type: number
 *                       description: Total normalized monthly spend across all active subscriptions
 *                       example: 89.97
 *                     monthly_trend:
 *                       type: array
 *                       description: Spend per month for the last 6 months
 *                       items:
 *                         $ref: '#/components/schemas/MonthlySpend'
 *                     category_breakdown:
 *                       type: array
 *                       description: Spend grouped by subscription category
 *                       items:
 *                         $ref: '#/components/schemas/CategorySpend'
 *                     active_subscriptions:
 *                       type: integer
 *                       description: Total number of active subscriptions included in spend
 *                       example: 5
 *       401:
 *         description: Unauthorized — valid Bearer token or auth cookie required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/spending', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const spending = await analyticsService.getSpending(req.user!.id);
    res.json({
      success: true,
      data: spending
    });
  } catch (error) {
    logger.error('Analytics spending error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch spending data'
    });
  }
});

/**
 * @swagger
 * /api/analytics/forecast:
 *   get:
 *     summary: Get projected spending forecast for the next 6 months
 *     description: Projects monthly spend for the next 6 months based on currently active subscriptions. Accounts for subscription start dates and cancellations.
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Spending forecast
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     forecast:
 *                       type: array
 *                       description: Projected spend for each of the next 6 months
 *                       items:
 *                         $ref: '#/components/schemas/MonthlySpend'
 *                     avg_projected_monthly_spend:
 *                       type: number
 *                       description: Average projected monthly spend across the forecast period
 *                       example: 91.50
 *       401:
 *         description: Unauthorized — valid Bearer token or auth cookie required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/forecast', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const forecast = await analyticsService.getForecast(req.user!.id);
    res.json({
      success: true,
      data: forecast
    });
  } catch (error) {
    logger.error('Analytics forecast error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch forecast data'
    });
  }
});

export default router;
