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

jest.mock('../src/services/subscription-service', () => ({
  subscriptionService: {
    createSubscription: jest.fn().mockResolvedValue({ id: 'sub-1' }),
    getSubscriptions: jest.fn().mockResolvedValue([]),
    updateSubscription: jest.fn().mockResolvedValue({ id: 'sub-1' }),
    deleteSubscription: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/services/user-service', () => ({
  userService: {
    getUserProfile: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
    updateUserProfile: jest.fn().mockResolvedValue({ id: 'user-1' }),
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

import subscriptionRoutes from '../src/routes/subscriptions';
import auditRoutes from '../src/routes/audit';
import complianceRoutes from '../src/routes/compliance';
import apiKeysRoutes from '../src/routes/api-keys';
import webhookRoutes from '../src/routes/webhooks';
import userRoutes from '../src/routes/user';
import { errorHandler } from '../src/middleware/errorHandler';

function createApp(path: string, router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  app.use(errorHandler);
  return app;
}

describe('Authorization Tests - All Route Groups', () => {
  describe('Subscriptions Routes - 401/403 Behavior', () => {
    const app = createApp('/api/subscriptions', subscriptionRoutes);

    it('GET /api/subscriptions returns 401 without authentication', async () => {
      const res = await request(app).get('/api/subscriptions');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('POST /api/subscriptions returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/subscriptions')
        .send({ name: 'Netflix', price: 15.99 });
      expect(res.status).toBe(401);
    });

    it('GET /api/subscriptions allows authenticated user', async () => {
      const res = await request(app)
        .get('/api/subscriptions')
        .set('x-test-role', 'owner');
      expect([200, 400]).toContain(res.status);
    });

    it('POST /api/subscriptions allows authenticated user', async () => {
      const res = await request(app)
        .post('/api/subscriptions')
        .set('x-test-role', 'owner')
        .send({ name: 'Netflix', price: 15.99 });
      expect([200, 400, 422]).toContain(res.status);
    });
  });

  describe('Audit Routes - 401/403 Behavior', () => {
    const app = createApp('/api/audit', auditRoutes);

    it('POST /api/audit returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/audit')
        .send({ events: [{ action: 'login', resource_type: 'auth' }] });
      expect(res.status).toBe(401);
    });

    it('GET /api/audit returns 401 without authentication', async () => {
      const res = await request(app).get('/api/audit');
      expect(res.status).toBe(401);
    });

    it('POST /api/audit allows authenticated user', async () => {
      const res = await request(app)
        .post('/api/audit')
        .set('x-test-role', 'owner')
        .send({ events: [{ action: 'login', resource_type: 'auth' }] });
      expect([200, 400, 422]).toContain(res.status);
    });
  });

  describe('Compliance Routes - 401/403 Behavior', () => {
    const app = createApp('/api/compliance', complianceRoutes);

    it('POST /api/compliance/account/delete returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete')
        .send({ reason: 'test' });
      expect(res.status).toBe(401);
    });

    it('POST /api/compliance/account/delete/cancel returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete/cancel');
      expect(res.status).toBe(401);
    });

    it('GET /api/compliance/account/data returns 401 without authentication', async () => {
      const res = await request(app).get('/api/compliance/account/data');
      expect(res.status).toBe(401);
    });

    it('POST /api/compliance/account/delete allows authenticated owner', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete')
        .set('x-test-role', 'owner')
        .send({ reason: 'test' });
      expect([200, 400, 422]).toContain(res.status);
    });

    it('POST /api/compliance/account/delete returns 403 for non-owner', async () => {
      const res = await request(app)
        .post('/api/compliance/account/delete')
        .set('x-test-role', 'member')
        .send({ reason: 'test' });
      expect(res.status).toBe(403);
    });
  });

  describe('API Keys Routes - 401/403 Behavior', () => {
    const app = createApp('/api/keys', apiKeysRoutes);

    it('GET /api/keys returns 401 without authentication', async () => {
      const res = await request(app).get('/api/keys');
      expect(res.status).toBe(401);
    });

    it('POST /api/keys returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/keys')
        .send({ name: 'test-key' });
      expect(res.status).toBe(401);
    });

    it('GET /api/keys returns 403 for member role', async () => {
      const res = await request(app)
        .get('/api/keys')
        .set('x-test-role', 'member');
      expect(res.status).toBe(403);
    });

    it('GET /api/keys returns 403 for viewer role', async () => {
      const res = await request(app)
        .get('/api/keys')
        .set('x-test-role', 'viewer');
      expect(res.status).toBe(403);
    });

    it('GET /api/keys allows admin role', async () => {
      const res = await request(app)
        .get('/api/keys')
        .set('x-test-role', 'admin');
      expect([200, 400]).toContain(res.status);
    });

    it('GET /api/keys allows owner role', async () => {
      const res = await request(app)
        .get('/api/keys')
        .set('x-test-role', 'owner');
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('Webhooks Routes - 401/403 Behavior', () => {
    const app = createApp('/api/webhooks', webhookRoutes);

    it('GET /api/webhooks returns 401 without authentication', async () => {
      const res = await request(app).get('/api/webhooks');
      expect(res.status).toBe(401);
    });

    it('POST /api/webhooks returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/webhooks')
        .send({ url: 'https://example.com/webhook' });
      expect(res.status).toBe(401);
    });

    it('GET /api/webhooks returns 403 for member role', async () => {
      const res = await request(app)
        .get('/api/webhooks')
        .set('x-test-role', 'member');
      expect(res.status).toBe(403);
    });

    it('GET /api/webhooks allows admin role', async () => {
      const res = await request(app)
        .get('/api/webhooks')
        .set('x-test-role', 'admin');
      expect([200, 400]).toContain(res.status);
    });

    it('GET /api/webhooks allows owner role', async () => {
      const res = await request(app)
        .get('/api/webhooks')
        .set('x-test-role', 'owner');
      expect([200, 400]).toContain(res.status);
    });
  });

  describe('User Routes - 401/403 Behavior', () => {
    const app = createApp('/api/user', userRoutes);

    it('GET /api/user/profile returns 401 without authentication', async () => {
      const res = await request(app).get('/api/user/profile');
      expect(res.status).toBe(401);
    });

    it('PUT /api/user/profile returns 401 without authentication', async () => {
      const res = await request(app)
        .put('/api/user/profile')
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(401);
    });

    it('GET /api/user/profile allows authenticated user', async () => {
      const res = await request(app)
        .get('/api/user/profile')
        .set('x-test-role', 'owner');
      expect([200, 400]).toContain(res.status);
    });

    it('PUT /api/user/profile allows authenticated user', async () => {
      const res = await request(app)
        .put('/api/user/profile')
        .set('x-test-role', 'owner')
        .send({ email: 'test@example.com' });
      expect([200, 400, 422]).toContain(res.status);
    });
  });

  describe('Authorization Failure Patterns', () => {
    it('all protected routes return 401 without token', async () => {
      const routes = [
        { method: 'get', path: '/api/subscriptions' },
        { method: 'get', path: '/api/audit' },
        { method: 'get', path: '/api/user/profile' },
      ];

      for (const route of routes) {
        const app = express();
        app.use(express.json());

        if (route.path.includes('subscriptions')) {
          app.use('/api/subscriptions', subscriptionRoutes);
        } else if (route.path.includes('audit')) {
          app.use('/api/audit', auditRoutes);
        } else if (route.path.includes('user')) {
          app.use('/api/user', userRoutes);
        }

        app.use(errorHandler);

        const res = await request(app)[route.method as 'get' | 'post'](route.path);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
      }
    });

    it('role-restricted routes return 403 for insufficient permissions', async () => {
      const app = createApp('/api/keys', apiKeysRoutes);

      const restrictedRoles = ['member', 'viewer'];
      for (const role of restrictedRoles) {
        const res = await request(app)
          .get('/api/keys')
          .set('x-test-role', role as UserRole);
        expect(res.status).toBe(403);
      }
    });
  });
});
