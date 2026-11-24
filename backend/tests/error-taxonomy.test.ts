import { createServer } from 'http';
import express, { Request, Response } from 'express';
import request from 'supertest';
import {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
  RateLimitError,
  ExternalDependencyError,
} from '../src/errors';
import { errorHandler } from '../src/middleware/errorHandler';

function buildApp(thrower: (req: Request, res: Response, next: any) => void) {
  const app = express();
  app.use(express.json());
  app.get('/test', thrower);
  app.use(errorHandler);
  return app;
}

describe('error taxonomy – class shapes', () => {
  it('NotFoundError has correct status and type', () => {
    const err = new NotFoundError('Widget not found');
    expect(err.status).toBe(404);
    expect(err.title).toBe('Not Found');
    expect(err.type).toBe('https://syncro.app/errors/not-found');
    expect(err.detail).toBe('Widget not found');
    expect(err).toBeInstanceOf(AppError);
  });

  it('ValidationError carries field errors', () => {
    const err = new ValidationError('Invalid input', { email: ['must be valid'] });
    expect(err.status).toBe(400);
    expect(err.errors).toEqual({ email: ['must be valid'] });
  });

  it('UnauthorizedError defaults message', () => {
    const err = new UnauthorizedError();
    expect(err.status).toBe(401);
    expect(err.detail).toBe('Authentication required.');
  });

  it('ForbiddenError defaults message', () => {
    const err = new ForbiddenError();
    expect(err.status).toBe(403);
    expect(err.detail).toBe('Access denied.');
  });

  it('ConflictError has 409 status', () => {
    const err = new ConflictError('Resource already exists');
    expect(err.status).toBe(409);
    expect(err.type).toBe('https://syncro.app/errors/conflict');
  });

  it('RateLimitError carries retryAfter', () => {
    const err = new RateLimitError('Slow down', 60);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(60);
    expect(err.extensions).toMatchObject({ retryAfter: 60 });
  });

  it('ExternalDependencyError has 502 status and dependency field', () => {
    const err = new ExternalDependencyError('Stripe is unreachable', 'stripe');
    expect(err.status).toBe(502);
    expect(err.dependency).toBe('stripe');
    expect(err.type).toBe('https://syncro.app/errors/external-dependency');
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('error taxonomy – HTTP response shapes via errorHandler', () => {
  it('NotFoundError → 404 Problem Details', async () => {
    const app = buildApp((_req, _res, next) => next(new NotFoundError('Widget not found')));
    const res = await request(app).get('/test');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'https://syncro.app/errors/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Widget not found',
    });
  });

  it('ValidationError → 400 with errors array', async () => {
    const app = buildApp((_req, _res, next) =>
      next(new ValidationError('Bad input', { name: ['required'] }))
    );
    const res = await request(app).get('/test');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      type: 'https://syncro.app/errors/validation',
      status: 400,
      errors: { name: ['required'] },
    });
  });

  it('UnauthorizedError → 401', async () => {
    const app = buildApp((_req, _res, next) => next(new UnauthorizedError()));
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.status).toBe(401);
  });

  it('ForbiddenError → 403', async () => {
    const app = buildApp((_req, _res, next) => next(new ForbiddenError()));
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.status).toBe(403);
  });

  it('ConflictError → 409', async () => {
    const app = buildApp((_req, _res, next) => next(new ConflictError('Duplicate key')));
    const res = await request(app).get('/test');
    expect(res.status).toBe(409);
    expect(res.body.status).toBe(409);
  });

  it('RateLimitError → 429 with retryAfter in body', async () => {
    const app = buildApp((_req, _res, next) => next(new RateLimitError('Too fast', 30)));
    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ status: 429, retryAfter: 30 });
  });

  it('ExternalDependencyError → 502 with dependency in body', async () => {
    const app = buildApp((_req, _res, next) =>
      next(new ExternalDependencyError('Redis unavailable', 'redis'))
    );
    const res = await request(app).get('/test');
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      type: 'https://syncro.app/errors/external-dependency',
      status: 502,
      dependency: 'redis',
    });
  });

  it('unknown error → 500 without leaking internals in production', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const app = buildApp((_req, _res, next) => next(new Error('secret internal error')));
    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(res.body.detail).toBe('An unexpected error occurred.');
    expect(res.body.detail).not.toContain('secret');

    process.env.NODE_ENV = original;
  });

  it('unknown error → 500 always returns application/problem+json', async () => {
    const app = buildApp((_req, _res, next) => next(new Error('boom')));
    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'https://syncro.app/errors/internal',
      title: 'Internal Server Error',
      status: 500,
    });
  });

  it('unknown error → 500 never exposes err.message in any environment', async () => {
    const savedEnv = process.env.NODE_ENV;

    for (const env of ['development', 'test', 'production']) {
      process.env.NODE_ENV = env;
      const app = buildApp((_req, _res, next) =>
        next(new Error('SUPER_SECRET_DB_PASSWORD=hunter2'))
      );
      const res = await request(app).get('/test');
      expect(res.body.detail).not.toContain('SUPER_SECRET_DB_PASSWORD');
      expect(res.body.detail).not.toContain('hunter2');
    }

    process.env.NODE_ENV = savedEnv;
  });

  it('AppError extensions are spread into RFC 7807 body but carry no raw Error internals', async () => {
    const app = buildApp((_req, _res, next) =>
      next(new ExternalDependencyError('Upstream down', 'stripe'))
    );
    const res = await request(app).get('/test');

    expect(res.status).toBe(502);
    // extensions field (dependency) should be present
    expect(res.body.dependency).toBe('stripe');
    // stack trace must never appear in any response
    expect(JSON.stringify(res.body)).not.toMatch(/at Object\.|at Function\.|\.ts:\d+/);
  });

  it('ZodError → 400 with application/problem+json', async () => {
    const { ZodError, z } = await import('zod');
    const schema = z.object({ name: z.string() });
    let zodErr: InstanceType<typeof ZodError>;
    try { schema.parse({}); } catch (e) { zodErr = e as InstanceType<typeof ZodError>; }

    const app = buildApp((_req, _res, next) => next(zodErr!));
    const res = await request(app).get('/test');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'https://syncro.app/errors/validation',
      title: 'Validation Error',
      status: 400,
    });
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});
