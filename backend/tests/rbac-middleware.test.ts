import express from 'express';
import request from 'supertest';
import { requireRole } from '../src/middleware/rbac';
import { adminAuth } from '../src/middleware/admin';
import type { AuthenticatedRequest } from '../src/middleware/auth';

describe('RBAC middleware', () => {
  const buildApp = (user?: AuthenticatedRequest['user']) => {
    const app = express();
    app.use((req: AuthenticatedRequest, _res, next) => {
      if (user) {
        req.user = user;
      }
      next();
    });
    app.get('/protected', requireRole('owner', 'admin'), (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  };

  it('returns 401 when user is not authenticated', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 403 when user role is not allowed', async () => {
    const res = await request(
      buildApp({ id: 'user-1', role: 'viewer', authMethod: 'jwt' }),
    ).get('/protected');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.body.message).toContain('owner, admin');
  });

  it('allows access when user role is permitted', async () => {
    const res = await request(
      buildApp({ id: 'user-1', role: 'admin', authMethod: 'jwt' }),
    ).get('/protected');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('adminAuth middleware', () => {
  const app = express();
  app.get('/admin-only', adminAuth, (_req, res) => {
    res.json({ ok: true });
  });

  it('returns 401 when admin API key header is missing', async () => {
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 403 when admin API key is invalid', async () => {
    const res = await request(app)
      .get('/admin-only')
      .set('x-admin-api-key', 'wrong-key');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('allows access with valid admin API key', async () => {
    const res = await request(app)
      .get('/admin-only')
      .set('x-admin-api-key', process.env.ADMIN_API_KEY!);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
