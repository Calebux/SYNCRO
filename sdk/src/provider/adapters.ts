/**
 * Typed framework adapters for the provider `metered()` middleware (issue #1666).
 *
 * `metered()` itself is framework-agnostic: it only needs the minimal
 * {@link MeteredRequest} / {@link MeteredResponse} surface. The helpers below
 * are thin typed wrappers so Express, Fastify, Hono, and fetch-style
 * (`Request` => `Response`) handlers get full type checking with no `any` in
 * the public provider API.
 *
 * @example Express
 * ```ts
 * import express from 'express';
 * import { expressMetered } from '@syncro/sdk/provider/adapters';
 *
 * const app = express();
 * app.use('/api', expressMetered({ 'GET /api/*': 0.01 }));
 * ```
 *
 * @example Fastify
 * ```ts
 * import Fastify from 'fastify';
 * import { fastifyMetered } from '@syncro/sdk/provider/adapters';
 *
 * const app = Fastify();
 * app.addHook('preHandler', fastifyMetered({ 'GET /api/*': 0.01 }));
 * ```
 *
 * @example Hono
 * ```ts
 * import { Hono } from 'hono';
 * import { honoMetered } from '@syncro/sdk/provider/adapters';
 *
 * const app = new Hono();
 * app.use('/api/*', honoMetered({ 'GET /api/*': 0.01 }));
 * ```
 *
 * @example Fetch-style (Next.js route handlers, Cloudflare Workers)
 * ```ts
 * import { fetchMetered } from '@syncro/sdk/provider/adapters';
 *
 * const withMetering = fetchMetered({ 'GET /api/*': 0.01 });
 * export const GET = (req: Request) => withMetering(req, () => Response.json({ ok: true }));
 * ```
 */

import {
  metered,
  type MeteredOptions,
  type MeteredRequest,
  type MeteredResponse,
} from './middleware.js';
import type { RoutePricing, PricingDeclarationInput } from './pricing.js';

// ── Shared facade ─────────────────────────────────────────────────────────────

interface CapturedResponse extends MeteredResponse {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
}

function createCapturedResponse(): CapturedResponse {
  const captured: CapturedResponse = {
    headers: {},
    locals: {},
    setHeader(name: string, value: string): void {
      captured.headers[name] = value;
    },
    status(code: number): { json: (body: unknown) => unknown } {
      captured.statusCode = code;
      return {
        json: (body: unknown): unknown => {
          captured.body = body;
          return body;
        },
      };
    },
  };
  return captured;
}

// ── Express ───────────────────────────────────────────────────────────────────

export interface ExpressMeteredRequest extends MeteredRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface ExpressMeteredResponse extends MeteredResponse {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => unknown };
}

export type ExpressMeteredNext = (err?: unknown) => unknown;

export function expressMetered(
  pricingInput: RoutePricing | PricingDeclarationInput,
  options: MeteredOptions<ExpressMeteredRequest, ExpressMeteredResponse> = {},
): (req: ExpressMeteredRequest, res: ExpressMeteredResponse, next: ExpressMeteredNext) => Promise<unknown> {
  return metered<ExpressMeteredRequest, ExpressMeteredResponse>(pricingInput, options);
}

// ── Fastify ───────────────────────────────────────────────────────────────────

export interface FastifyMeteredRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface FastifyMeteredReply {
  header: (name: string, value: string) => unknown;
  code: (statusCode: number) => FastifyMeteredReply;
  send: (body: unknown) => unknown;
}

function toMeteredRequest(req: FastifyMeteredRequest): MeteredRequest {
  return { method: req.method, url: req.url, headers: req.headers };
}

function applyCaptured(reply: FastifyMeteredReply, captured: CapturedResponse): void {
  for (const [name, value] of Object.entries(captured.headers)) {
    reply.header(name, value);
  }
}

export function fastifyMetered(
  pricingInput: RoutePricing | PricingDeclarationInput,
  options: MeteredOptions = {},
): (req: FastifyMeteredRequest, reply: FastifyMeteredReply) => Promise<unknown> {
  const run = metered(pricingInput, options);
  return async (req: FastifyMeteredRequest, reply: FastifyMeteredReply): Promise<unknown> => {
    const captured = createCapturedResponse();
    let nextError: unknown;
    let nextCalled = false;
    await run(toMeteredRequest(req), captured, (err?: unknown): unknown => {
      nextError = err;
      nextCalled = true;
      return undefined;
    });
    applyCaptured(reply, captured);
    if (captured.statusCode !== undefined) {
      return reply.code(captured.statusCode).send(captured.body);
    }
    if (nextError !== undefined) {
      throw nextError;
    }
    if (nextCalled) {
      return undefined;
    }
    return undefined;
  };
}

// ── Hono ──────────────────────────────────────────────────────────────────────

export interface HonoMeteredContext {
  req: {
    raw: Request;
    path: string;
    method: string;
  };
  header: (name: string, value: string) => void;
  json: (body: unknown, status?: number) => unknown;
}

export type HonoMeteredNext = () => Promise<void>;

function headersFromRequest(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value: string, key: string): void => {
    out[key] = value;
  });
  return out;
}

export function honoMetered(
  pricingInput: RoutePricing | PricingDeclarationInput,
  options: MeteredOptions = {},
): (c: HonoMeteredContext, next: HonoMeteredNext) => Promise<unknown> {
  const run = metered(pricingInput, options);
  return async (c: HonoMeteredContext, next: HonoMeteredNext): Promise<unknown> => {
    const raw = c.req.raw;
    const url = new URL(raw.url);
    const facadeReq: MeteredRequest = {
      method: c.req.method,
      path: url.pathname,
      url: url.pathname,
      originalUrl: url.pathname,
      headers: headersFromRequest(raw),
    };
    const captured = createCapturedResponse();
    let nextError: unknown;
    await run(facadeReq, captured, (err?: unknown): unknown => {
      nextError = err;
      return undefined;
    });
    for (const [name, value] of Object.entries(captured.headers)) {
      c.header(name, value);
    }
    if (captured.statusCode !== undefined) {
      return c.json(captured.body, captured.statusCode);
    }
    if (nextError !== undefined) {
      throw nextError;
    }
    return next();
  };
}

// ── Fetch-style (`Request` => `Response`) ─────────────────────────────────────

export type FetchHandler = (req: Request) => Response | Promise<Response>;

export function fetchMetered(
  pricingInput: RoutePricing | PricingDeclarationInput,
  options: MeteredOptions = {},
): (req: Request, handler: FetchHandler) => Promise<Response> {
  const run = metered(pricingInput, options);
  return async (req: Request, handler: FetchHandler): Promise<Response> => {
    const url = new URL(req.url);
    const facadeReq: MeteredRequest = {
      method: req.method,
      path: url.pathname,
      url: url.pathname,
      originalUrl: url.pathname,
      headers: headersFromRequest(req),
    };
    const captured = createCapturedResponse();
    let nextError: unknown;
    await run(facadeReq, captured, (err?: unknown): unknown => {
      nextError = err;
      return undefined;
    });
    if (captured.statusCode !== undefined) {
      return Response.json(captured.body, {
        status: captured.statusCode,
        headers: captured.headers,
      });
    }
    if (nextError !== undefined) {
      throw nextError;
    }
    const res = await handler(req);
    if (Object.keys(captured.headers).length === 0) {
      return res;
    }
    const outHeaders = new Headers(res.headers);
    for (const [name, value] of Object.entries(captured.headers)) {
      outHeaders.set(name, value);
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
    });
  };
}
