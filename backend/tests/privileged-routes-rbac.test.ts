import express from 'express';
import request from 'supertest';
import type { UserRole } from '../src/middleware/auth';

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/middleware/rate-limit-factory', () => ({
  RateLimiterFactory: {
    createCustomLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  },
}));

jest.mock('../src/services/audit-service', () => ({
  auditService: {
    insertBatch: jest.fn().mockResolvedValue({ success: true, inserted: 1, failed: 0, errors: [] }),
    getAllLogs: jest.fn().mockResolvedValue([]),
    getLogsCount: jest.fn().mockResolvedValue(0),
  },
}));

jest.mock('../src/services/compliance-service', () => ({
  complianceService: {
    requestDeletion: jest.fn().mockResolvedValue({ user_id: 'user-1', status: 'pending' }),
    cancelDeletion: jest.fn().mockResolvedValue({ user_id: 'user-1', status: 'cancelled' }),
    getDeletionStatus: jest.fn().mockResolvedValue({ status: 'none' }),
    gatherUserData: jest.fn().mockResolvedValue({
      profile: {},
      subscriptions: [],
      notifications: [],
      auditLogs: [],
      preferences: {},
      emailAccounts: [],
      teams: [],
      blockchainLogs: [],
    }),
    verifyUnsubscribeToken: jest.fn(),
  },
}));

jest.mock('../src/services/webhook-service', () => ({
  webhookService: {
    registerWebhook: jest.fn().mockResolvedValue({ id: 'wh-1' }),
    listWebhooks: jest.fn().mockResolvedValue([]),
    updateWebhook: jest.fn().mockResolvedValue({ id: 'wh-1' }),
    deleteWebhook: jest.fn().mockResolvedValue(undefined),
    triggerTestEvent: jest.fn().mockResolvedValue({ id: 'delivery-1' }),
    getDeliveries: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      insert: jest.fn().mockResolvedValue({ data: [], error: null }),
      update: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
    })),
    auth: { getUser: jest.fn() },
  },
}));

jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      const role = req.headers['x-test-role'] as UserRole | undefined;
      if (!role) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }
      req.user = {
        id: 'test-user-id',
        role,
        authMethod: 'jwt',
        scopes: ['subscriptions:read', 'subscriptions:write', 'webhooks:write', 'analytics:read'],
      };
      next();
    },
    requireScope: () => (_req: any, _res: any, next: any) => next(),
  };
});

import auditRoutes from '../src/routes/audit';
import complianceRoutes from '../src/routes/compliance';
import apiKeysRoutes from '../src/routes/api-keys';
import webhookRoutes from '../src/routes/webhooks';
import { adminAuth } from '../src/middleware/admin';
import { errorHandler } from '../src/middleware/errorHandler';

function createApp(path: string, router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  app.use(errorHandler);
  return app;
}

describe('Privileged route RBAC enforcement', () => {
  describe('POST /api/audit', () => {
    const app = createApp('/api/audit', auditRoutes);

    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/audit')
        .send({ events: [{ action: 'login', resource_type: 'auth' }] });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/audit', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/audit', auditRoutes);
    app.use(errorHandler);

    it('returns 401 without admin API key', async () => {
      const res = await request(app).get('/api/audit');
      expect(res.status).toBe(401);
    });

    it('returns 403 with invalid admin API key', async () => {
      const res = await request(app)
        .get('/api/audit')
        .set('x-admin-api-key', 'invalid');

      expect(res.status).toBe(403);
    });
  });

  describe('Compliance account deletion routes', () => {
    const app = createApp('/api/compliance', complianceRoutes);

    it('returns 401 for delete without auth', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete')
        .send({ reason: 'test' });

      expect(res.status).toBe(401);
    });

    it('returns 403 when non-owner requests deletion', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete')
        .set('x-test-role', 'admin')
        .send({ reason: 'test' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('allows owner to request deletion', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete')
        .set('x-test-role', 'owner')
        .send({ reason: 'test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 403 when non-owner cancels deletion', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete/cancel')
        .set('x-test-role', 'member');

      expect(res.status).toBe(403);
    });

    it('allows owner to cancel deletion', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete/cancel')
        .set('x-test-role', 'owner');

      expect(res.status).toBe(200);
    });
  });

  describe('/api/keys routes', () => {
    const app = createApp('/api/keys', apiKeysRoutes);

    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/keys');
      expect(res.status).toBe(401);
    });

    it('returns 403 for member role', async () => {
      const res = await request(app).get('/api/keys').set('x-test-role', 'member');
      expect(res.status).toBe(403);
    });

    it('returns 403 for viewer role', async () => {
      const res = await request(app).get('/api/keys').set('x-test-role', 'viewer');
      expect(res.status).toBe(403);
    });
  });

  describe('/api/webhooks routes', () => {
    const app = createApp('/api/webhooks', webhookRoutes);

    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/webhooks');
      expect(res.status).toBe(401);
    });

    it('returns 403 for member role', async () => {
      const res = await request(app).get('/api/webhooks').set('x-test-role', 'member');
      expect(res.status).toBe(403);
    });
  });

  describe('Admin process routes', () => {
    const app = express();
    app.get('/api/admin/health', adminAuth, (_req, res) => {
      res.json({ status: 'healthy' });
    });
    app.use(errorHandler);

    it('returns 401 without admin API key', async () => {
      const res = await request(app).get('/api/admin/health');
      expect(res.status).toBe(401);
    });

    it('returns 403 with invalid admin API key', async () => {
      const res = await request(app)
        .get('/api/admin/health')
        .set('x-admin-api-key', 'bad-key');

      expect(res.status).toBe(403);
    });

    it('allows valid admin API key', async () => {
      const res = await request(app)
        .get('/api/admin/health')
        .set('x-admin-api-key', process.env.ADMIN_API_KEY!);

      expect(res.status).toBe(200);
    });
  });
});
