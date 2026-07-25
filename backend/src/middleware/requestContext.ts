import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';
import { v7 as uuidv7 } from 'uuid';
import * as Sentry from '@sentry/node';

/** Shape of the per-request context stored in AsyncLocalStorage */
export interface RequestContext {
  requestId: string;
  /** Populated by auth middleware once the user is known */
  userId?: string;
}

/** Extended Express Request with requestId attached */
export interface RequestWithContext extends Request {
  requestId?: string;
}

/**
 * Singleton AsyncLocalStorage instance.
 * Import this anywhere in the codebase to read the current request context
 * without threading it through function arguments.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Express middleware that assigns a unique time-ordered UUID v7 correlation ID
 * to every incoming request.
 *
 * - Respects an upstream `X-Request-ID` or `X-Correlation-ID` header
 *   (e.g. from a load balancer) so IDs remain consistent across service hops.
 * - Stores the context in AsyncLocalStorage so it is automatically available
 *   anywhere down the async call stack.
 * - Echoes the correlation ID back in both `x-request-id` (backward compat)
 *   and `X-Correlation-ID` (canonical) response headers.
 * - Adds a Sentry breadcrumb with the correlation ID for end-to-end tracing.
 */
export function requestIdMiddleware(
  req: RequestWithContext,
  res: Response,
  next: NextFunction,
): void {
  // Respect upstream correlation ID from either header
  const requestId =
    (req.headers['x-correlation-id'] as string | undefined) ||
    (req.headers['x-request-id'] as string | undefined) ||
    uuidv7();

  // Attach to request object for easy manual passing if needed
  req.requestId = requestId;
  
  // Echo back in both headers: canonical X-Correlation-ID and backward-compat x-request-id
  res.setHeader('X-Correlation-ID', requestId);
  res.setHeader('x-request-id', requestId);

  requestContextStorage.run({ requestId }, () => {
    // Add Sentry breadcrumb inside the request context for proper association
    Sentry.addBreadcrumb({
      category: 'request',
      message: `Request assigned correlation ID: ${requestId}`,
      level: 'info',
      data: { correlationId: requestId },
    });
    next();
  });
}

/**
 * Helper to get the current requestId from AsyncLocalStorage.
 * Returns undefined if called outside of a request context.
 */
export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

/**
 * Call this from your auth middleware after the user has been verified to
 * attach the userId to the current request context.
 */
export function setRequestUserId(userId: string): void {
  const store = requestContextStorage.getStore();
  if (store) {
    store.userId = userId;
  }
}

/**
 * Run an async job (cron, queue worker, etc.) with a fresh correlation ID
 * so all log entries and audit events produced inside `fn` carry the same ID.
 *
 * Uses UUID v7 (time-ordered) for improved database index locality.
 *
 * Usage:
 *   await runWithCorrelationId('cron:reminder', async () => { ... });
 */
export function runWithCorrelationId<T>(
  label: string,
  fn: (correlationId: string) => Promise<T>,
): Promise<T> {
  const correlationId = `${label}:${uuidv7()}`;
  return requestContextStorage.run({ requestId: correlationId }, () => fn(correlationId));
}
