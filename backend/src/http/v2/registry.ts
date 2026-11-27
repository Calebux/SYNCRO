import { Request, Response, NextFunction, Router } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../errors';
import {
  isPaginated,
  wrapProblem,
  wrapSuccess,
  V2_PROBLEM_TYPES,
  type Paginated,
  type V2Success,
} from './envelope';
import { CursorError, parseV2ListQuery } from './cursor';

export type V2Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type V2Auth = 'public' | 'user' | 'admin';

export interface V2HandlerContext {
  req: Request;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  requestId: string;
}

export type V2HandlerResult = unknown | Paginated<unknown> | V2Success<unknown>;

export type V2Handler = (ctx: V2HandlerContext) => Promise<V2HandlerResult> | V2HandlerResult;

export interface V2RouteDefinition {
  method: V2Method;
  path: string;
  auth: V2Auth;
  list?: boolean;
  status?: number;
  handler: V2Handler;
}

function requestIdOf(req: Request, res: Response): string {
  const header = (res.getHeader('x-request-id') || req.headers['x-request-id']) as string | undefined;
  return header || 'unknown';
}

function instanceOf(req: Request): string {
  return req.originalUrl.split('?')[0] || req.path;
}

export function toProblem(err: unknown, req: Request, res: Response) {
  const requestId = requestIdOf(req, res);
  const instance = instanceOf(req);

  if (err instanceof CursorError) {
    return {
      status: 400,
      body: wrapProblem({
        type: V2_PROBLEM_TYPES.invalidCursor,
        title: 'Invalid Cursor',
        status: 400,
        detail: err.message,
        instance,
        requestId,
      }),
    };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      body: wrapProblem({
        type: V2_PROBLEM_TYPES.validation,
        title: 'Validation Error',
        status: 400,
        detail: 'The request input failed validation.',
        instance,
        requestId,
        errors: err.issues.map((issue) => ({
          field: issue.path.join('.') || 'value',
          message: issue.message,
        })),
      }),
    };
  }

  if (err instanceof AppError) {
    const type =
      err.status === 401
        ? V2_PROBLEM_TYPES.unauthorized
        : err.status === 403
          ? V2_PROBLEM_TYPES.forbidden
          : err.status === 404
            ? V2_PROBLEM_TYPES.notFound
            : err.status === 409
              ? V2_PROBLEM_TYPES.conflict
              : err.status === 429
                ? V2_PROBLEM_TYPES.rateLimit
                : err.type?.startsWith('http') || err.type?.startsWith('https')
                  ? err.type
                  : V2_PROBLEM_TYPES.validation;
    return {
      status: err.status,
      body: wrapProblem({
        type,
        title: err.title,
        status: err.status,
        detail: err.detail,
        instance,
        requestId,
      }),
    };
  }

  const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
  return {
    status: 500,
    body: wrapProblem({
      type: V2_PROBLEM_TYPES.internal,
      title: 'Internal Server Error',
      status: 500,
      detail: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : message,
      instance,
      requestId,
    }),
  };
}

export function envelopeFromHandlerResult(
  result: V2HandlerResult,
  requestId: string,
): { statusExtra?: number; body: V2Success<unknown> } {
  if (result && typeof result === 'object' && 'data' in result && 'meta' in result) {
    return { body: result as V2Success<unknown> };
  }
  if (isPaginated(result)) {
    return { body: wrapSuccess(result.items, requestId, result.pagination) };
  }
  return { body: wrapSuccess(result, requestId) };
}

/**
 * Registry so v2 handlers return domain values. The wrapper is the only place
 * that knows about the HTTP envelope.
 */
export class V2RouteRegistry {
  private readonly routes: V2RouteDefinition[] = [];

  register(def: V2RouteDefinition): this {
    this.routes.push(def);
    return this;
  }

  list(): readonly V2RouteDefinition[] {
    return this.routes;
  }

  mount(router: Router, middleware: Partial<Record<V2Auth, Array<(req: Request, res: Response, next: NextFunction) => void>>> = {}): Router {
    for (const def of this.routes) {
      const guards = def.auth === 'public' ? [] : (middleware[def.auth] ?? []);
      const wrapped = async (req: Request, res: Response, next: NextFunction) => {
        try {
          const requestId = requestIdOf(req, res);
          const query = { ...(req.query as Record<string, unknown>) };
          if (def.list) {
            parseV2ListQuery(query);
          }
          const result = await def.handler({
            req,
            params: req.params as Record<string, string>,
            query,
            body: req.body,
            requestId,
          });
          const wrappedResult = envelopeFromHandlerResult(result, requestId);
          res
            .status(def.status ?? 200)
            .type('application/json')
            .json(wrappedResult.body);
        } catch (err) {
          const problem = toProblem(err, req, res);
          res.status(problem.status).type('application/problem+json').json(problem.body);
        }
      };
      router[def.method](def.path, ...guards, wrapped);
    }
    return router;
  }
}

export function createV2Registry(): V2RouteRegistry {
  return new V2RouteRegistry();
}
