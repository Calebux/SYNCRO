import express from 'express';
import request from 'supertest';
import { ZodError } from 'zod';
import {
  v2SuccessSchema,
  v2ProblemSchema,
  wrapSuccess,
  wrapProblem,
  paginate,
  V2_PROBLEM_TYPES,
} from '../src/http/v2/envelope';
import { encodeV2Cursor, decodeV2Cursor, CursorError, parseV2ListQuery } from '../src/http/v2/cursor';
import { createV2Registry, envelopeFromHandlerResult, toProblem } from '../src/http/v2/registry';
import { v2Registry } from '../src/routes/v2/catalog';
import { NotFoundError, ValidationError } from '../src/errors';

function requestId() {
  return 'req_test_1';
}

describe('v2 envelope contract', () => {
  it('wraps a domain object in the success envelope', () => {
    const body = wrapSuccess({ id: 'sub_01', name: 'Netflix' }, requestId());
    expect(v2SuccessSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      data: { id: 'sub_01', name: 'Netflix' },
      meta: { request_id: 'req_test_1', version: 'v2' },
    });
    expect(body).not.toHaveProperty('success');
  });

  it('wraps a list with cursor pagination', () => {
    const page = paginate([{ id: '1' }], {
      next_cursor: encodeV2Cursor({ createdAt: '2026-08-01T00:00:00.000Z', id: '1' }),
      has_more: true,
      limit: 20,
    });
    const body = envelopeFromHandlerResult(page, requestId()).body;
    expect(v2SuccessSchema.safeParse(body).success).toBe(true);
    expect(body.pagination?.has_more).toBe(true);
    expect(body.pagination?.next_cursor).toMatch(/^v2c\./);
  });

  it('emits RFC 7807 problem details', () => {
    const problem = wrapProblem({
      type: V2_PROBLEM_TYPES.validation,
      title: 'Validation Error',
      status: 400,
      detail: 'The request input failed validation.',
      instance: '/api/v2/subscriptions',
      requestId: requestId(),
      errors: [{ field: 'limit', message: 'Limit must be at least 1' }],
    });
    expect(v2ProblemSchema.safeParse(problem).success).toBe(true);
    expect(problem.type).toContain('syncro.app/problems/');
  });
});

describe('v2 opaque cursor', () => {
  const keyset = { createdAt: '2026-08-01T12:00:00.000Z', id: 'abc' };

  it('round-trips a keyset', () => {
    const token = encodeV2Cursor(keyset);
    expect(token.startsWith('v2c.')).toBe(true);
    expect(decodeV2Cursor(token)).toEqual(keyset);
  });

  it('is not a bare JSON object', () => {
    const token = encodeV2Cursor(keyset);
    expect(() => JSON.parse(token)).toThrow();
    expect(token.includes(keyset.id)).toBe(false);
  });

  it('rejects tampering', () => {
    const token = encodeV2Cursor(keyset);
    const parts = token.split('.');
    parts[2] = parts[2].replace(/A/g, 'B') + 'x';
    expect(() => decodeV2Cursor(parts.join('.'))).toThrow(CursorError);
  });

  it('rejects truncated and random input', () => {
    expect(() => decodeV2Cursor('not-a-cursor')).toThrow(CursorError);
    expect(() => decodeV2Cursor('v2c.aaaa')).toThrow(CursorError);
    expect(decodeV2Cursor(undefined)).toBeNull();
  });

  it('validates limit on input', () => {
    expect(parseV2ListQuery({}).limit).toBe(20);
    expect(() => parseV2ListQuery({ limit: 0 })).toThrow(ZodError);
    expect(() => parseV2ListQuery({ limit: 101 })).toThrow(ZodError);
    expect(() => parseV2ListQuery({ cursor: 'garbage' })).toThrow(CursorError);
  });

  it('is stable under insertion at the same timestamp', () => {
    const page = [
      { createdAt: '2026-08-01T12:00:00.000Z', id: 'b' },
      { createdAt: '2026-08-01T12:00:00.000Z', id: 'a' },
    ];
    const cursor = encodeV2Cursor(page[0]);
    const decoded = decodeV2Cursor(cursor)!;
    const inserted = { createdAt: '2026-08-01T12:00:00.000Z', id: 'c' };
    const remaining = [...page.slice(1), inserted].filter((row) => {
      if (row.createdAt < decoded.createdAt) return true;
      if (row.createdAt > decoded.createdAt) return false;
      return row.id < decoded.id;
    });
    expect(remaining.map((r) => r.id).sort()).toEqual(['a']);
    expect(remaining.find((r) => r.id === 'c')).toBeUndefined();
  });
});

describe('v2 surface schema (whole registry)', () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader('x-request-id', 'req_surface');
    next();
  });

  const surface = createV2Registry();
  for (const route of v2Registry.list()) {
    surface.register({
      ...route,
      auth: 'public',
      handler: async () => {
        if (route.list) {
          return paginate([{ id: 'fixture' }], {
            next_cursor: null,
            has_more: false,
            limit: 20,
          });
        }
        if (route.path.includes(':id')) {
          return { id: 'fixture' };
        }
        return { status: 'ok', version: 'v2' };
      },
    });
  }
  surface.register({
    method: 'get',
    path: '/__probe/not-found',
    auth: 'public',
    handler: async () => {
      throw new NotFoundError('missing');
    },
  });
  surface.register({
    method: 'get',
    path: '/__probe/invalid-limit',
    auth: 'public',
    list: true,
    handler: async () => paginate([], { next_cursor: null, has_more: false, limit: 20 }),
  });
  surface.mount(app);

  it('registers the production v2 surface', () => {
    const paths = v2Registry.list().map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /health',
        'GET /subscriptions',
        'GET /subscriptions/:id',
        'GET /tags',
      ]),
    );
  });

  it('every registered v2 route returns the success envelope', async () => {
    for (const route of v2Registry.list()) {
      const path = route.path.replace(':id', 'sub_01');
      const http = await request(app)[route.method](path);
      expect(http.status).toBe(200);
      const parsed = v2SuccessSchema.safeParse(http.body);
      expect(parsed.success).toBe(true);
      expect(http.body.meta.version).toBe('v2');
      if (route.list) {
        expect(http.body.pagination).toEqual(
          expect.objectContaining({ has_more: false, limit: 20, next_cursor: null }),
        );
      }
    }
  });

  it('maps domain errors to the problem envelope', async () => {
    const res = await request(app).get('/__probe/not-found');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(v2ProblemSchema.safeParse(res.body).success).toBe(true);
  });

  it('rejects an invalid list limit with the problem envelope', async () => {
    const res = await request(app).get('/__probe/invalid-limit').query({ limit: 0 });
    expect(res.status).toBe(400);
    expect(v2ProblemSchema.safeParse(res.body).success).toBe(true);
  });

  it('rejects a malformed cursor with invalid-cursor', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    const list = await request(app).get('/subscriptions').query({ cursor: 'tampered' });
    expect(list.status).toBe(400);
    expect(list.body.type).toBe(V2_PROBLEM_TYPES.invalidCursor);
    expect(v2ProblemSchema.safeParse(list.body).success).toBe(true);
  });
});

describe('toProblem mapping', () => {
  const req = { originalUrl: '/api/v2/x', path: '/api/v2/x', headers: { 'x-request-id': 'r' } } as express.Request;
  const res = { getHeader: () => 'r' } as unknown as express.Response;

  it('maps ZodError to validation', () => {
    const err = new ZodError([{ code: 'custom', message: 'bad', path: ['limit'] } as never]);
    const problem = toProblem(err, req, res);
    expect(problem.status).toBe(400);
    expect(problem.body.type).toBe(V2_PROBLEM_TYPES.validation);
  });

  it('maps ValidationError', () => {
    const problem = toProblem(new ValidationError('nope'), req, res);
    expect(problem.status).toBe(400);
  });
});
