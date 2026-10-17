import { describe, it, expect } from '@jest/globals';
import { expressMetered, fastifyMetered, honoMetered, fetchMetered } from '../src/provider/adapters.js';
import type {
  ExpressMeteredRequest,
  ExpressMeteredResponse,
  FastifyMeteredRequest,
  FastifyMeteredReply,
  HonoMeteredContext,
} from '../src/provider/adapters.js';

function expressRes(): ExpressMeteredResponse & { headers: Record<string, string>; statusCode?: number; body?: unknown } {
  const res = {
    headers: {} as Record<string, string>,
    locals: {} as Record<string, unknown>,
    setHeader(name: string, value: string): void {
      res.headers[name] = value;
    },
    status(code: number): { json: (body: unknown) => unknown } {
      res.statusCode = code;
      return {
        json: (body: unknown): unknown => {
          res.body = body;
          return body;
        },
      };
    },
  };
  return res;
}

describe('expressMetered', () => {
  it('serves free routes and attaches a receipt', async () => {
    const run = expressMetered({ 'GET /free': 0 });
    const req: ExpressMeteredRequest = { method: 'GET', path: '/free', headers: {} };
    const res = expressRes();
    let nextCalled = false;
    await run(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.headers['X-Syncro-Receipt']).toContain('"status":"free"');
  });

  it('rejects paid routes without a proof with 402', async () => {
    const run = expressMetered({ 'GET /paid': 0.01 });
    const req: ExpressMeteredRequest = { method: 'GET', path: '/paid', headers: {} };
    const res = expressRes();
    await run(req, res, () => undefined);
    expect(res.statusCode).toBe(402);
  });
});

describe('fastifyMetered', () => {
  it('lets free routes through and forwards receipt headers', async () => {
    const run = fastifyMetered({ 'GET /free': 0 });
    const req: FastifyMeteredRequest = { method: 'GET', url: '/free', headers: {} };
    const sent: { code?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
    const reply: FastifyMeteredReply = {
      header: (n: string, v: string): unknown => {
        sent.headers[n] = v;
        return undefined;
      },
      code: (c: number): FastifyMeteredReply => {
        sent.code = c;
        return reply;
      },
      send: (b: unknown): unknown => {
        sent.body = b;
        return b;
      },
    };
    await run(req, reply);
    expect(sent.code).toBeUndefined();
    expect(sent.headers['X-Syncro-Receipt']).toContain('"status":"free"');
  });

  it('replies 402 for paid routes without a proof', async () => {
    const run = fastifyMetered({ 'GET /paid': 0.01 });
    const req: FastifyMeteredRequest = { method: 'GET', url: '/paid', headers: {} };
    const sent: { code?: number; body?: unknown } = {};
    const reply: FastifyMeteredReply = {
      header: (): unknown => undefined,
      code: (c: number): FastifyMeteredReply => {
        sent.code = c;
        return reply;
      },
      send: (b: unknown): unknown => {
        sent.body = b;
        return b;
      },
    };
    await run(req, reply);
    expect(sent.code).toBe(402);
    expect(sent.body).toBeDefined();
  });
});

describe('honoMetered', () => {
  function honoContext(path: string, headers: Record<string, string> = {}): HonoMeteredContext & { status?: number; body?: unknown } {
    const ctx = {
      req: { raw: new Request(`https://example.com${path}`, { headers }), path, method: 'GET' },
      sentHeaders: {} as Record<string, string>,
      status: undefined as number | undefined,
      body: undefined as unknown,
      header(name: string, value: string): void {
        ctx.sentHeaders[name] = value;
      },
      json(body: unknown, status?: number): unknown {
        ctx.status = status;
        ctx.body = body;
        return body;
      },
    };
    return ctx;
  }

  it('calls next() for free routes', async () => {
    const run = honoMetered({ 'GET /free': 0 });
    const ctx = honoContext('/free');
    let nextCalled = false;
    await run(ctx, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(ctx.status).toBeUndefined();
  });

  it('returns 402 JSON for paid routes without a proof', async () => {
    const run = honoMetered({ 'GET /paid': 0.01 });
    const ctx = honoContext('/paid');
    await run(ctx, async () => undefined);
    expect(ctx.status).toBe(402);
    expect(ctx.body).toBeDefined();
  });
});

describe('fetchMetered', () => {
  it('delegates to the handler for free routes', async () => {
    const withMetering = fetchMetered({ 'GET /free': 0 });
    const res = await withMetering(new Request('https://example.com/free'), () => Response.json({ ok: true }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('returns 402 without calling the handler when unpaid', async () => {
    const withMetering = fetchMetered({ 'GET /paid': 0.01 });
    let handlerCalled = false;
    const res = await withMetering(new Request('https://example.com/paid'), () => {
      handlerCalled = true;
      return Response.json({ ok: true });
    });
    expect(handlerCalled).toBe(false);
    expect(res.status).toBe(402);
  });

  it('forwards paid requests that carry a proof', async () => {
    const withMetering = fetchMetered({ 'GET /paid': 0.01 });
    const res = await withMetering(
      new Request('https://example.com/paid', { headers: { 'X-Syncro-Payment-Proof': 'proof-123' } }),
      () => Response.json({ ok: true }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Syncro-Receipt')).toContain('"status":"settled"');
  });
});
