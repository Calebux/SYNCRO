import express, { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { RateLimiterFactory } from '../middleware/rate-limit-factory';
import { authenticate, optionalAuthenticate, requireScope, AuthenticatedRequest } from '../middleware/auth';
import { adminAuth } from '../middleware/admin';
import { validateRequest } from '../utils/validation';
import { auditService, emitSecurityEvent, SecurityEventType, SecurityEventMeta } from '../services/audit-service';
import { getRequestId } from '../middleware/requestContext';
import {
  RouteDescriptor,
  RegistryMountOptions,
  MountedRoute,
  OpenApiRouteInfo,
  AuthPolicy,
  RateLimitPolicy,
  ValidationSchema,
  AuditEventConfig,
} from './types';

const mountedRoutes: MountedRoute[] = [];
const openApiRoutes: OpenApiRouteInfo[] = [];

function buildAuthMiddleware(auth: AuthPolicy): RequestHandler[] {
  const middlewares: RequestHandler[] = [];

  switch (auth.type) {
    case 'public':
      break;
    case 'user':
      middlewares.push(authenticate);
      if (auth.requiredScopes && auth.requiredScopes.length > 0) {
        middlewares.push(requireScope(auth.requiredScopes));
      }
      break;
    case 'admin':
      middlewares.push(adminAuth);
      break;
    case 'apiKey':
      middlewares.push(authenticate);
      if (auth.requiredScopes && auth.requiredScopes.length > 0) {
        middlewares.push(requireScope(auth.requiredScopes));
      }
      break;
  }

  return middlewares;
}

function buildRateLimitMiddleware(rateLimit: RateLimitPolicy): RequestHandler[] {
  const middlewares: RequestHandler[] = [];

  if (rateLimit.type === 'standard') {
    const limiterCreator = RateLimiterFactory[rateLimit.limiterName] as (this: typeof RateLimiterFactory) => RequestHandler;
    if (typeof limiterCreator === 'function') {
      middlewares.push(limiterCreator.call(RateLimiterFactory));
    }
  } else if (rateLimit.type === 'custom') {
    middlewares.push(rateLimit.limiter);
  }

  return middlewares;
}

function buildValidationMiddleware(validation: ValidationSchema[]): RequestHandler[] {
  if (validation.length === 0) return [];

  return validation.map(({ target, schema }) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        let data: unknown;
        switch (target) {
          case 'body':
            data = req.body;
            break;
          case 'query':
            data = req.query;
            break;
          case 'params':
            data = req.params;
            break;
          case 'headers':
            data = req.headers;
            break;
        }
        const validated = validateRequest(schema, data);
        switch (target) {
          case 'body':
            req.body = validated;
            break;
          case 'query':
            req.query = validated as Record<string, string>;
            break;
          case 'params':
            req.params = validated as Record<string, string>;
            break;
          case 'headers':
            break;
        }
        next();
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({
            error: 'ValidationError',
            message: 'Request validation failed',
            details: error.errors.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          });
          return;
        }
        next(error);
      }
    };
  });
}

function buildAuditMiddleware(
  audit: AuditEventConfig | null,
  method: string,
  path: string
): RequestHandler[] {
  if (!audit) return [];

  return [
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const originalJson = res.json.bind(res);
      let responseBody: unknown = null;

      res.json = (body: unknown) => {
        responseBody = body;
        return originalJson(body);
      };

      res.on('finish', async () => {
        try {
          const userId = req.user?.id;
          const ipAddress = req.ip;
          const userAgent = req.get('user-agent');

          const metadata: Record<string, unknown> = {
            method,
            path,
            statusCode: res.statusCode,
            correlationId: getRequestId(),
          };

          if (audit.includeRequestBody && req.body) {
            metadata.requestBody = req.body;
          }

          if (audit.includeResponseBody && responseBody) {
            metadata.responseBody = responseBody;
          }

          await auditService.insertEntry({
            userId,
            action: audit.action,
            resourceType: audit.resourceType,
            resourceId: (req.params.id as string) || (req.params.resourceId as string),
            metadata,
            ipAddress,
            userAgent,
          });
        } catch (error) {
          console.error('Audit logging failed:', error);
        }
      });

      next();
    },
  ];
}

function authPolicyToSecurity(auth: AuthPolicy): 'public' | 'user' | 'admin' {
  switch (auth.type) {
    case 'public':
      return 'public';
    case 'user':
    case 'apiKey':
      return 'user';
    case 'admin':
      return 'admin';
  }
}

function extractSchemaForOpenApi(validation: ValidationSchema[], target: ValidationSchema['target']): z.ZodTypeAny | undefined {
  const v = validation.find((v) => v.target === target);
  return v?.schema;
}

function generateResponses(audit: AuditEventConfig | null, x402: boolean): OpenApiRouteInfo['responses'] {
  const responses: OpenApiRouteInfo['responses'] = {
    '200': { description: 'Successful response' },
    '401': { description: 'Unauthorized' },
    '500': { description: 'Internal server error' },
  };

  if (audit) {
    responses['400'] = { description: 'Validation error' };
    responses['403'] = { description: 'Forbidden' };
    responses['404'] = { description: 'Not found' };
  }

  if (x402) {
    responses['402'] = { description: 'Payment required (x402)' };
  }

  return responses;
}

export function registerRoute(
  router: Router,
  descriptor: RouteDescriptor,
  options: RegistryMountOptions
): void {
  const { basePath, version } = options;
  const fullPath = basePath + descriptor.path;

  const authMiddlewares = buildAuthMiddleware(descriptor.auth);
  const rateLimitMiddlewares = buildRateLimitMiddleware(descriptor.rateLimit);
  const validationMiddlewares = buildValidationMiddleware(descriptor.validation);
  const auditMiddlewares = buildAuditMiddleware(descriptor.audit, descriptor.method, fullPath);

  const allMiddlewares = [
    ...authMiddlewares,
    ...rateLimitMiddlewares,
    ...validationMiddlewares,
    ...auditMiddlewares,
  ];

  const method = descriptor.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  (router as any)[method](fullPath, ...allMiddlewares, descriptor.handler);

  mountedRoutes.push({
    method: descriptor.method.toUpperCase(),
    path: descriptor.path,
    fullPath,
    version,
    descriptor,
  });

  openApiRoutes.push({
    method: descriptor.method.toUpperCase(),
    path: fullPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
    summary: descriptor.summary || `${descriptor.method.toUpperCase()} ${fullPath}`,
    description: descriptor.description,
    tags: descriptor.tags || ['API'],
    security: authPolicyToSecurity(descriptor.auth),
    x402: descriptor.x402 || false,
    requestBody: extractSchemaForOpenApi(descriptor.validation, 'body'),
    queryParams: extractSchemaForOpenApi(descriptor.validation, 'query'),
    pathParams: extractSchemaForOpenApi(descriptor.validation, 'params'),
    responses: generateResponses(descriptor.audit, descriptor.x402 || false),
  });
}

export function createVersionedRouter(options: RegistryMountOptions): Router {
  const router = Router();
  return router;
}

export function getMountedRoutes(): MountedRoute[] {
  return [...mountedRoutes];
}

export function getOpenApiRoutes(): OpenApiRouteInfo[] {
  return [...openApiRoutes];
}

export function clearRegistry(): void {
  mountedRoutes.length = 0;
  openApiRoutes.length = 0;
}

export function validateRegistry(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const route of mountedRoutes) {
    if (route.descriptor.auth.type === 'public' && route.fullPath.startsWith('/api/')) {
      const publicApiRoutes = ['/health', '/api-docs', '/api/docs', '/metrics'];
      const isPublicApi = publicApiRoutes.some((p) => route.fullPath.startsWith(p));
      if (!isPublicApi) {
        errors.push(`Route ${route.method} ${route.fullPath} is public but under /api/ - explicit auth required`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}