import { Request, Response, NextFunction } from 'express';
import { admissionService } from '../services/admission-service';
import logger from '../config/logger';
import { admissionConfig } from '../config/admission';
import { AuthenticatedRequest } from './auth';

/**
 * Admission middleware for x402-gated endpoints.
 *
 * This middleware runs the admission check before allowing access to
 * paid endpoints. It enforces the latency budget and caches results
 * where appropriate.
 */

export interface AdmissionMiddlewareOptions {
  /** Require all checks to pass (default: true) */
  requireAllChecks: boolean;
  /** Custom error handler */
  onError?: (req: Request, res: Response, error: Error) => void;
}

const defaultOptions: AdmissionMiddlewareOptions = {
  requireAllChecks: true,
};

/**
 * Create the admission middleware.
 */
export function createAdmissionMiddleware(options: Partial<AdmissionMiddlewareOptions> = {}) {
  const opts = { ...defaultOptions, ...options };

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!admissionConfig.budget.enableBudgetEnforcement) {
      next();
      return;
    }

    try {
      const result = await admissionService.admit(req);

      // Attach admission result to request for downstream use
      (req as any).admissionResult = result;

      if (!result.admitted) {
        const fatalErrors = result.errors.filter(e => e.fatal);
        if (fatalErrors.length > 0) {
          logger.warn('Admission denied', {
            userId: req.userId,
            errors: result.errors.map(e => e.message),
            totalLatencyMs: result.totalLatencyMs,
          });
          res.status(402).json({
            error: 'Payment Required',
            detail: fatalErrors[0].message,
            admissionResult: result,
          });
          return;
        }
      }

      // Log budget compliance
      if (!result.p99Compliant) {
        logger.warn('Admission budget not compliant', {
          totalLatencyMs: result.totalLatencyMs,
          budgetMs: admissionConfig.budget.totalBudgetMs,
          p99LatencyMs: admissionService.getP99Latency(),
        });
      }

      next();
    } catch (error) {
      logger.error('Admission middleware error:', error);
      if (opts.onError) {
        opts.onError(req, res, error instanceof Error ? error : new Error(String(error)));
      } else {
        res.status(500).json({
          error: 'Internal Server Error',
          detail: 'Admission check failed',
        });
      }
    }
  };
}

/**
 * Lightweight admission check for endpoints that need quick verification.
 * This checks only the essential requirements without full caching.
 */
export async function quickAdmissionCheck(req: AuthenticatedRequest): Promise<boolean> {
  const startTime = Date.now();
  const result = await admissionService.admit(req);
  const latencyMs = Date.now() - startTime;

  // Warn if exceeding individual step budget
  const stepBudgets = admissionConfig.budget.stepBudgets;
  if (result.stepLatenciesMs.identityResolution > stepBudgets.identityResolutionMs * 1.5) {
    logger.warn('Identity resolution exceeded step budget', { latencyMs: result.stepLatenciesMs.identityResolution });
  }

  return result.admitted;
}

/**
 * Get the admission status for health checks and monitoring.
 */
export async function getAdmissionStatus(): Promise<{
  p99LatencyMs: number;
  budgetMs: number;
  compliant: boolean;
  sampleCount: number;
  cacheAvailable: boolean;
}> {
  const budgetStatus = admissionService.getBudgetStatus();
  const cacheAvailable = await admissionCacheAvailable();

  return {
    p99LatencyMs: budgetStatus.p99LatencyMs,
    budgetMs: budgetStatus.budgetMs,
    compliant: budgetStatus.compliant,
    sampleCount: budgetStatus.sampleCount,
    cacheAvailable,
  };
}

/**
 * Check if the admission cache is available.
 */
async function admissionCacheAvailable(): Promise<boolean> {
  try {
    const { admissionCacheService } = await import('../services/admission-cache');
    return await admissionCacheService.isRedisAvailable();
  } catch {
    return false;
  }
}

export { admissionService };