import { Router, Request, Response } from 'express';
import { sliMetricsService } from '../services/sli-metrics-service';
import logger from '../config/logger';

const router = Router();

/**
 * GET /metrics or GET /api/metrics
 * Exposes core Service Level Indicators (SLIs):
 *  - Renewal Success Rate (%)
 *  - Webhook Processing Lag (ms)
 *  - Notification Queue Depth
 *  - Dead-Letter Queue Counts
 *
 * Supports Prometheus text exposition format (default) and JSON format
 * via `Accept: application/json` header or `?format=json` query parameter.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const wantsJson =
      req.query.format === 'json' ||
      req.headers.accept?.includes('application/json');

    if (wantsJson) {
      const metrics = await sliMetricsService.getSliMetrics();
      return res.status(200).json(metrics);
    }

    const prometheusText = await sliMetricsService.formatPrometheusMetrics();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.status(200).send(prometheusText);
  } catch (error) {
    logger.error('Failed to export SLI metrics:', error);
    return res.status(500).json({
      error: 'Failed to generate metrics snapshot',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
