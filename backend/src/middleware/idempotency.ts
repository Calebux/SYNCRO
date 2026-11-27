import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { idempotencyService } from '../services/idempotency';
import { BadRequestError, ConflictError } from '../errors';
import logger from '../config/logger';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const REPLAY_HEADER = 'Idempotent-Replay';

export interface IdempotencyOptions {
  /**
   * Whether the `Idempotency-Key` header is required on this route.
   * Defaults to `true` — this middleware is meant for mutating routes
   * that must never double-execute (payments, refunds, webhook
   * replay/delivery actions). Pass `false` to make the key optional,
   * with idempotency enforced whenever the caller does send one.
   */
  required?: boolean;
}

/**
 * Builds the route identity an idempotency key is scoped to. Two
 * different users can safely reuse the same key value; two different
 * routes reusing the same key value from the same user must not be
 * treated as a collision either.
 */
function routeIdentity(req: AuthenticatedRequest): string {
  const mountPath = req.baseUrl || '';
  const routePath = req.route?.path;
  return `${req.method} ${mountPath}${typeof routePath === 'string' ? routePath : req.path}`;
}

/**
 * Idempotency middleware for mutating routes.
 *
 * Declaring this on a route (rather than relying on the handler to call
 * the idempotency service itself) is the fix for issue #1270: idempotency
 * becomes a property of the route, enforced on every request, instead of
 * something each handler has to remember to do.
 *
 * Behaviour:
 *  - Missing key on a route where `required` is true -> 400.
 *  - New key -> request proceeds; the handler's JSON response is captured
 *    and stored once it completes.
 *  - Same key + identical request body -> the stored response is
 *    replayed verbatim and the handler never runs.
 *  - Same key + different request body -> 409, handler never runs.
 *
 * Must be mounted after `authenticate` — it needs `req.user.id` to scope
 * keys per user.
 */
export function idempotent(options: IdempotencyOptions = {}) {
  const { required = true } = options;

  return async function idempotencyMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const rawKey = req.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!key) {
      if (required) {
        throw new BadRequestError(
          `The "${IDEMPOTENCY_HEADER}" header is required for this request.`
        );
      }
      next();
      return;
    }

    if (!req.user?.id) {
      // No authenticated user to scope the key to. This middleware is for
      // authenticated mutating routes; if it ends up on an unauthenticated
      // one, fail open rather than silently skip idempotency guarantees.
      throw new BadRequestError(
        'Idempotency-Key requires an authenticated request.'
      );
    }

    const userId = req.user.id;
    const route = routeIdentity(req);
    const requestHash = idempotencyService.hashRequest({
      params: req.params ?? {},
      query: req.query ?? {},
      body: req.body ?? null,
    } as any);

    const { record } = await idempotencyService.checkKey(key, userId, route);

    if (record) {
      if (record.request_hash !== requestHash) {
        throw new ConflictError(
          `Idempotency-Key "${key}" was already used for this request with a different request body.`
        );
      }

      logger.info('Idempotent replay served from cache', { key, route, userId });
      res.setHeader(REPLAY_HEADER, 'true');
      res.status(record.response_status).json(record.response_body);
      return;
    }

    // Wrap res.json so whatever status/body the handler ultimately sends
    // gets persisted once, without requiring the handler to know anything
    // about idempotency. Only successful/client-error responses (< 500)
    // are stored: a 5xx likely reflects a transient failure the caller
    // should be able to retry with the same key rather than getting the
    // failure replayed forever.
    const originalJson = res.json.bind(res);
    let alreadyStored = false;

    res.json = ((body: unknown) => {
      const result = originalJson(body);
      if (!alreadyStored && res.statusCode < 500) {
        alreadyStored = true;
        idempotencyService
          .storeResponse(key, userId, requestHash, res.statusCode, body, route)
          .catch((err) =>
            logger.error('Failed to persist idempotency record', {
              key,
              route,
              userId,
              error: err instanceof Error ? err.message : String(err),
            })
          );
      }
      return result;
    }) as typeof res.json;

    next();
  };
}
