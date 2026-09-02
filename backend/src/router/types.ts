import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth';
import { RateLimitRequestHandler } from 'express-rate-limit';
import { RateLimiterFactory } from '../middleware/rate-limit-factory';

export type ApiVersion = 'v1' | 'v2';

export type AuthPolicy =
  | { type: 'public' }
  | { type: 'user'; requiredScopes?: string[] }
  | { type: 'admin' }
  | { type: 'apiKey'; requiredScopes?: string[] };

export type LimiterName = keyof typeof RateLimiterFactory;

export type RateLimitPolicy =
  | { type: 'none' }
  | { type: 'standard'; limiterName: LimiterName }
  | { type: 'custom'; limiter: RateLimitRequestHandler };

export type ValidationTarget = 'body' | 'query' | 'params' | 'headers';

export interface ValidationSchema {
  target: ValidationTarget;
  schema: z.ZodTypeAny;
}

export type AuditEventType =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'list'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed'
  | 'security.rate_limited'
  | 'security.unauthorized_access'
  | 'custom';

export interface AuditEventConfig {
  type: AuditEventType;
  resourceType: string;
  action: string;
  includeRequestBody?: boolean;
  includeResponseBody?: boolean;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface RouteDescriptor {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  version: ApiVersion;
  auth: AuthPolicy;
  rateLimit: RateLimitPolicy;
  validation: ValidationSchema[];
  audit: AuditEventConfig | null;
  handler: RequestHandler;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  x402?: boolean;
}

export interface RegistryMountOptions {
  basePath: string;
  version: ApiVersion;
}

export interface MountedRoute {
  method: string;
  path: string;
  fullPath: string;
  version: ApiVersion;
  descriptor: RouteDescriptor;
}

export interface OpenApiRouteInfo {
  method: string;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  security: 'public' | 'user' | 'admin';
  x402: boolean;
  requestBody?: z.ZodTypeAny;
  queryParams?: z.ZodTypeAny;
  pathParams?: z.ZodTypeAny;
  responses: Record<string, { description: string; schema?: z.ZodTypeAny }>;
}