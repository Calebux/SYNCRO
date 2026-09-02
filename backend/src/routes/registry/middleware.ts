import { RequestHandler, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { adminAuth } from '../../middleware/admin';
import {
  createAdminLimiter,
  createMfaLimiter,
  createLoginLimiter,
  createTeamInviteLimiter,
  createImportLimiter,
  createPaymentLimiter,
  createRefundLimiter,
  createApiKeyLimiter,
  createSimulationLimiter,
  createStealthAddressLimiter,
  createZkProofLimiter,
  createPaymentChannelStateUpdateLimiter,
  createSelectiveDisclosureLimiter,
  createSubscriptionTierLimiter,
} from '../../middleware/rate-limit-factory';
import { validate } from '../../middleware/validate';
import { auditService } from '../../services/audit-service';
import logger from '../../config/logger';
import type { RouteDescriptor, AuthPolicy, RateLimitPolicy } from './types';

const RATE_LIMITERS: Record<string, () => RequestHandler> = {
  admin: createAdminLimiter,
  login: createLoginLimiter,
  mfa: createMfaLimiter,
  'team-invite': createTeamInviteLimiter,
  import: createImportLimiter,
  payment: createPaymentLimiter,
  refund: createRefundLimiter,
  'api-key': createApiKeyLimiter,
  simulation: createSimulationLimiter,
  'stealth-address': createStealthAddressLimiter,
  'zk-proof': createZkProofLimiter,
  'payment-channel-state-update': createPaymentChannelStateUpdateLimiter,
  'selective-disclosure': createSelectiveDisclosureLimiter,
  'subscription-tier': () => createSubscriptionTierLimiter(),
};

export function resolveAuthMiddleware(auth: AuthPolicy): RequestHandler | null {
  switch (auth) {
    case 'user':
      return authenticate;
    case 'admin':
      return adminAuth;
    case 'public':
      return null;
  }
}

export function resolveRateLimitMiddleware(
  policy: RateLimitPolicy,
): RequestHandler | null {
  if (!policy) return null;
  const factory = RATE_LIMITERS[policy];
  if (!factory) {
    throw new Error(`Unknown rate-limit policy: ${policy}`);
  }
  return factory();
}

export function buildValidationMiddleware(
  schemas: RouteDescriptor['schemas'],
): RequestHandler[] {
  if (!schemas) return [];
  const middlewares: RequestHandler[] = [];
  if (schemas.body) middlewares.push(validate(schemas.body, 'body'));
  if (schemas.query) middlewares.push(validate(schemas.query, 'query'));
  if (schemas.params) middlewares.push(validate(schemas.params, 'params'));
  return middlewares;
}

/**
 * Wrap a handler to emit an audit event after successful execution.
 */
function auditMiddleware(auditEvent: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Fire-and-forget audit event — do not block the response.
    const auditPromise = (async () => {
      try {
        await auditService.log({
          action: auditEvent,
          userId: (req as any).user?.id,
          resourceType: 'api_route',
          details: {
            method: req.method,
            path: req.originalUrl,
          },
        });
      } catch (err) {
        logger.error('[registry-audit] Failed to emit audit event', {
          event: auditEvent,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    // Catch unhandled rejection so Node doesn't warn
    auditPromise.catch(() => {});

    next();
  };
}

/**
 * Build the full middleware chain for a route descriptor.
 *
 * Order: rawBody -> rateLimit -> auth -> schemas -> extra middleware -> audit -> handler
 */
export function buildMiddlewareChain(
  descriptor: RouteDescriptor,
): RequestHandler[] {
  const chain: RequestHandler[] = [];

  // 1. Raw body (webhook endpoints)
  if (descriptor.rawBody) {
    chain.push(
      (
        _req: Request,
        res: Response,
        next: NextFunction,
      ) => {
        // raw body is applied at the mount level via express.raw()
        // this is a placeholder — the actual raw body middleware is
        // applied by the registry when mounting
        next();
      },
    );
  }

  // 2. Rate limiting
  const rateLimiter = resolveRateLimitMiddleware(descriptor.rateLimit ?? null);
  if (rateLimiter) {
    chain.push(rateLimiter);
  }

  // 3. Auth
  const authMiddleware = resolveAuthMiddleware(descriptor.auth);
  if (authMiddleware) {
    chain.push(authMiddleware);
  }

  // 4. Validation from schemas
  chain.push(...buildValidationMiddleware(descriptor.schemas));

  // 5. Extra middleware
  if (descriptor.middleware) {
    chain.push(...descriptor.middleware);
  }

  // 6. Audit event emission (after auth, before handler)
  if (descriptor.auditEvent) {
    chain.push(auditMiddleware(descriptor.auditEvent));
  }

  // 7. Handler(s)
  if (Array.isArray(descriptor.handler)) {
    chain.push(...descriptor.handler);
  } else {
    chain.push(descriptor.handler);
  }

  return chain;
}
