import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import {
  RouteDescriptor,
  AuthPolicy,
  RateLimitPolicy,
  ValidationSchema,
  AuditEventConfig,
  ApiVersion,
} from './types';
import { RateLimiterFactory } from '../middleware/rate-limit-factory';

export type HandlerFn = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

export interface DescriptorOptions {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  version: ApiVersion;
  handler: HandlerFn;
  auth?: AuthPolicy;
  rateLimit?: RateLimitPolicy;
  validation?: ValidationSchema[];
  audit?: AuditEventConfig | null;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  x402?: boolean;
}

export function createDescriptor(options: DescriptorOptions): RouteDescriptor {
  return {
    method: options.method,
    path: options.path,
    version: options.version,
    auth: options.auth || { type: 'user' },
    rateLimit: options.rateLimit || { type: 'none' },
    validation: options.validation || [],
    audit: options.audit ?? null,
    handler: options.handler,
    summary: options.summary,
    description: options.description,
    tags: options.tags,
    deprecated: options.deprecated,
    x402: options.x402,
  };
}

export const auth = {
  public: (): AuthPolicy => ({ type: 'public' }),
  user: (requiredScopes?: string[]): AuthPolicy => ({ type: 'user', requiredScopes }),
  admin: (): AuthPolicy => ({ type: 'admin' }),
  apiKey: (requiredScopes?: string[]): AuthPolicy => ({ type: 'apiKey', requiredScopes }),
};

export const rateLimit = {
  none: (): RateLimitPolicy => ({ type: 'none' }),
  standard: (limiterName: keyof typeof RateLimiterFactory): RateLimitPolicy => ({
    type: 'standard',
    limiterName,
  }),
  custom: (limiter: any): RateLimitPolicy => ({
    type: 'custom',
    limiter,
  }),
};

export const validate = {
  body: (schema: z.ZodTypeAny): ValidationSchema => ({ target: 'body', schema }),
  query: (schema: z.ZodTypeAny): ValidationSchema => ({ target: 'query', schema }),
  params: (schema: z.ZodTypeAny): ValidationSchema => ({ target: 'params', schema }),
  headers: (schema: z.ZodTypeAny): ValidationSchema => ({ target: 'headers', schema }),
};

export const audit = {
  create: (resourceType: string, options?: { includeRequestBody?: boolean; includeResponseBody?: boolean; severity?: 'low' | 'medium' | 'high' | 'critical' }): AuditEventConfig => ({
    type: 'create',
    resourceType,
    action: 'create',
    includeRequestBody: options?.includeRequestBody ?? true,
    includeResponseBody: options?.includeResponseBody ?? false,
    severity: options?.severity ?? 'low',
  }),
  read: (resourceType: string, options?: { includeResponseBody?: boolean }): AuditEventConfig => ({
    type: 'read',
    resourceType,
    action: 'read',
    includeResponseBody: options?.includeResponseBody ?? false,
    severity: 'low',
  }),
  update: (resourceType: string, options?: { includeRequestBody?: boolean; includeResponseBody?: boolean }): AuditEventConfig => ({
    type: 'update',
    resourceType,
    action: 'update',
    includeRequestBody: options?.includeRequestBody ?? true,
    includeResponseBody: options?.includeResponseBody ?? false,
    severity: 'low',
  }),
  delete: (resourceType: string): AuditEventConfig => ({
    type: 'delete',
    resourceType,
    action: 'delete',
    severity: 'medium',
  }),
  list: (resourceType: string): AuditEventConfig => ({
    type: 'list',
    resourceType,
    action: 'list',
    severity: 'low',
  }),
  custom: (action: string, resourceType: string, options?: Partial<AuditEventConfig>): AuditEventConfig => ({
    type: 'custom',
    resourceType,
    action,
    ...options,
  }),
  none: (): null => null,
};

export const commonSchemas = {
  idParam: z.object({ id: z.string().uuid() }),
  paginationQuery: z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
  }),
};