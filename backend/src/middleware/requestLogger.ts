import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import { apiLatencyService } from '../services/api-latency-service';

/**
 * Logs the start and end of every HTTP request including:
 *   - method, path, status code, duration (ms)
 *   - requestId and userId are injected automatically by the logger
 *
 * Must be registered AFTER requestIdMiddleware so the context is already set.
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startMs = Date.now();

  logger.info('Request started', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Hook into the response 'finish' event to log completion
  res.on('finish', async () => {
    const durationMs = Date.now() - startMs;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'info';

    logger[level]('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });

    // Record latency for endpoint family
    try {
      const family = apiLatencyService.getEndpointFamily(req.method, req.path);
      await apiLatencyService.recordLatency(family, durationMs);
    } catch (error) {
      logger.error('Failed to record API latency metric:', error);
    }
  });

  next();
}
