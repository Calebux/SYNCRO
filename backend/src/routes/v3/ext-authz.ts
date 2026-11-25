import express, { NextFunction, Request, Response, Router } from 'express';
import {
  EnvoyExtAuthzService,
  EXT_AUTHZ_HEADERS,
  ExtAuthzReply,
} from '../../v3/ext-authz/envoy-ext-authz';

/**
 * Envoy ext_authz endpoints (#1826). Mounted at `/api/v3/ext-authz`.
 *
 *   ANY  /check/<original path>  Envoy HTTP ext_authz service
 *                                (`http_service.path_prefix: /api/v3/ext-authz/check`)
 *   POST /settle                 Called by the Envoy Lua response filter
 *
 * Both require `x-syncro-ext-authz-secret`; without SYNCRO_EXT_AUTHZ_SECRET
 * configured they answer 503 so a misconfigured deployment fails closed.
 * See deploy/envoy-ext-authz/README.md.
 */

const SETTLE_BODY_LIMIT = '1mb';

function lowerCaseHeaders(req: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const key = name.toLowerCase();
    if (key === EXT_AUTHZ_HEADERS.secret) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

function send(res: Response, reply: ExtAuthzReply): void {
  for (const [name, value] of Object.entries(reply.headers)) {
    if (name !== 'content-type') res.setHeader(name, value);
  }
  res.status(reply.status);
  if (reply.body === undefined) res.end();
  else res.json(reply.body);
}

function parseUpstreamBody(raw: unknown): unknown {
  if (Buffer.isBuffer(raw)) {
    if (raw.length === 0) return undefined;
    const text = raw.toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  // Already parsed by an earlier body parser (e.g. JSON content type).
  return raw;
}

export function createEnvoyExtAuthzRouter(service: EnvoyExtAuthzService): Router {
  const router = Router();

  const requireEnvoy = (req: Request, res: Response, next: NextFunction): void => {
    if (!service.isConfigured()) {
      res.status(503).json({ error: 'ext_authz_not_configured', message: 'SYNCRO_EXT_AUTHZ_SECRET is not set' });
      return;
    }
    if (!service.authenticate(req.header(EXT_AUTHZ_HEADERS.secret))) {
      res.status(403).json({ error: 'forbidden', message: 'Invalid ext_authz secret' });
      return;
    }
    next();
  };

  router.post(
    '/settle',
    requireEnvoy,
    express.raw({ type: () => true, limit: SETTLE_BODY_LIMIT }),
    async (req: Request, res: Response) => {
      const headers = lowerCaseHeaders(req);
      const upstreamHeaders: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(headers)) {
        if (name.startsWith(EXT_AUTHZ_HEADERS.upstreamHeaderPrefix)) {
          upstreamHeaders[name.slice(EXT_AUTHZ_HEADERS.upstreamHeaderPrefix.length)] = value;
        }
      }
      const reply = await service.settle(headers[EXT_AUTHZ_HEADERS.reservationId], {
        status: Number(headers[EXT_AUTHZ_HEADERS.upstreamStatus]),
        headers: upstreamHeaders,
        body: parseUpstreamBody(req.body),
      });
      send(res, reply);
    },
  );

  // `use` strips the `/check` prefix, leaving the original downstream URL.
  router.use('/check', requireEnvoy, async (req: Request, res: Response) => {
    const url = new URL(req.url || '/', 'http://ext-authz.invalid');
    const reply = await service.check({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: lowerCaseHeaders(req),
      body: req.body,
    });
    send(res, reply);
  });

  return router;
}

let defaultRouter: Router | null = null;

/** Lazily wires the service onto the gateway lifecycle so importing this file stays cheap. */
export default function v3ExtAuthzRoutes(req: Request, res: Response, next: NextFunction): void {
  if (!defaultRouter) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createLifecycleExtAuthzDeps } = require('../../v3/ext-authz/lifecycle-deps') as typeof import('../../v3/ext-authz/lifecycle-deps');
    defaultRouter = createEnvoyExtAuthzRouter(
      new EnvoyExtAuthzService(createLifecycleExtAuthzDeps(), {
        sharedSecret: process.env.SYNCRO_EXT_AUTHZ_SECRET,
      }),
    );
  }
  defaultRouter(req, res, next);
}
