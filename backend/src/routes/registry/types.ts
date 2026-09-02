import { RequestHandler } from 'express';
import { ZodType } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL';

export type AuthPolicy = 'public' | 'user' | 'admin';

export type RateLimitPolicy =
  | 'admin'
  | 'login'
  | 'mfa'
  | 'team-invite'
  | 'import'
  | 'payment'
  | 'refund'
  | 'api-key'
  | 'simulation'
  | 'stealth-address'
  | 'zk-proof'
  | 'payment-channel-state-update'
  | 'selective-disclosure'
  | 'subscription-tier'
  | null;

export interface RouteDescriptor {
  /** HTTP method — 'ALL' mounts on every method via app.use() */
  method: HttpMethod;

  /** Path relative to the version prefix, e.g. '/' or '/:id' */
  path: string;

  /** API version — 'v1', 'v2', etc. */
  version: string;

  /**
   * Auth requirement. MUST be set explicitly.
   * 'public' — no auth required
   * 'user'   — requires authenticated user (JWT / API key)
   * 'admin'  — requires admin API key
   *
   * Setting this to undefined is a compile-time error — every route must
   * declare its auth policy explicitly.
   */
  auth: AuthPolicy;

  /** Rate-limit policy name applied before auth */
  rateLimit?: RateLimitPolicy;

  /** OpenAPI tags for grouping */
  tags?: string[];

  /** Short summary shown in OpenAPI docs */
  summary?: string;

  /** Longer description for OpenAPI docs */
  description?: string;

  /** Audit event name emitted after successful handler execution */
  auditEvent?: string;

  /** Zod schemas for request validation and OpenAPI generation */
  schemas?: {
    body?: ZodType<any>;
    query?: ZodType<any>;
    params?: ZodType<any>;
  };

  /** The route handler(s) — for ALL method, use a Router or handler that handles all methods */
  handler: RequestHandler | RequestHandler[];

  /** Additional middleware to apply after auth but before handler */
  middleware?: RequestHandler[];

  /** Mount raw body parser (needed for webhook signature verification) */
  rawBody?: boolean;

  /** Enable x402 micropayment headers in OpenAPI */
  x402?: boolean;

  /** Mark as deprecated in OpenAPI */
  deprecated?: boolean;
}

export interface RegistryConfig {
  /** Base path prefix for all routes, e.g. '/api' */
  basePath: string;

  /** All route descriptors */
  descriptors: RouteDescriptor[];
}
