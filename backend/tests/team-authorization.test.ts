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

jest.mock('../src/services/email-service', () => ({
  emailService: {
    sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
    sendNotification: jest.fn().mockResolvedValue(undefined),
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
      delete: jest.fn().mockReturnThis(),
    })),
    auth: {
      getUser: jest.fn(),
      admin: {
        getUserById: jest.fn().mockResolvedValue({ data: { user: { id: 'test-user-id', email: 'test@example.com' } } }),
        getUserByEmail: jest.fn().mockResolvedValue({ data: { user: { id: 'invitee-id', email: 'invitee@example.com' } } }),
      },
    },
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
        email: 'test@example.com',
      };
      next();
    },
    requireScope: () => (_req: any, _res: any, next: any) => next(),
  };
});

jest.mock('../src/middleware/team-auth', () => ({
  attachTeamAuth: (req: any, _res: any, next: any) => {
    const teamRole = req.headers['x-team-role'] as string | undefined;
    req.teamAuth = {
      teamId: 'test-team-id',
      teamRole: teamRole || 'viewer',
      isOwner: teamRole === 'owner',
      isOperator: teamRole === 'operator',
      isViewer: teamRole === 'viewer',
    };
    next();
  },
  requireTeamRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    const teamAuth = req.teamAuth;
    if (!teamAuth) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Team authorization required' });
    }
    if (!roles.includes(teamAuth.teamRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of the following team roles: ${roles.join(', ')}`,
      });
    }
    next();
  },
  requireOwnerMfa: () => (req: any, res: any, next: any) => {
    if (!req.user || req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Forbidden', message: 'Only team owners can perform this action' });
    }
    if (!req.mfaVerified) {
      return res.status(403).json({ error: 'MFA Required', message: 'MFA re-authentication required' });
    }
    next();
  },
  requireMfaReauth: (req: any, res: any, next: any) => {
    const mfaVerified = req.headers['x-mfa-verified'] === 'true' || req.query.mfa_verified === 'true';
    if (!mfaVerified) {
      return res.status(403).json({ error: 'MFA Required', message: 'MFA re-authentication required' });
    }
    req.mfaVerified = true;
    next();
  },
  canTeamRolePerformAction: (_role: string, _action: string) => true,
}));

import teamRoutes from '../src/routes/team';
import paymentChannelsRoutes from '../src/routes/payment-channels';
import { errorHandler } from '../src/middleware/errorHandler';

function createApp(path: string, router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('v3 Team Authorization — Role-Action Matrix', () => {
  describe('Team Routes (GET /api/team)', () => {
    const app = createApp('/api/team', teamRoutes);

    it('owner can view team members', async () => {
      const res = await request(app)
        .get('/api/team')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner');
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator can view team members', async () => {
      const res = await request(app)
        .get('/api/team')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator');
      expect([200, 400, 500]).toContain(res.status);
    });

    it('viewer can view team members', async () => {
      const res = await request(app)
        .get('/api/team')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer');
      expect([200, 400, 500]).toContain(res.status);
    });
  });

  describe('Team Routes (POST /api/team/invite)', () => {
    const app = createApp('/api/team', teamRoutes);

    it('owner can invite members', async () => {
      const res = await request(app)
        .post('/api/team/invite')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .send({ email: 'new@example.com', role: 'operator' });
      expect([200, 201, 400, 409, 500]).toContain(res.status);
    });

    it('operator can invite members', async () => {
      const res = await request(app)
        .post('/api/team/invite')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator')
        .send({ email: 'new@example.com', role: 'viewer' });
      expect([200, 201, 400, 409, 500]).toContain(res.status);
    });

    it('viewer cannot invite members', async () => {
      const res = await request(app)
        .post('/api/team/invite')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer')
        .send({ email: 'new@example.com', role: 'viewer' });
      expect(res.status).toBe(403);
    });
  });

  describe('Team Routes (GET /api/team/pending)', () => {
    const app = createApp('/api/team', teamRoutes);

    it('owner can view pending invitations', async () => {
      const res = await request(app)
        .get('/api/team/pending')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner');
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator can view pending invitations', async () => {
      const res = await request(app)
        .get('/api/team/pending')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator');
      expect([200, 400, 500]).toContain(res.status);
    });

    it('viewer cannot view pending invitations', async () => {
      const res = await request(app)
        .get('/api/team/pending')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer');
      expect(res.status).toBe(403);
    });
  });

  describe('Team Routes (PUT /api/team/:memberId/role) — grant authority', () => {
    const app = createApp('/api/team', teamRoutes);

    it('owner can update member role (with MFA)', async () => {
      const res = await request(app)
        .put('/api/team/test-member-id/role')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .set('x-mfa-verified', 'true')
        .send({ role: 'operator' });
      expect([200, 400, 404, 500]).toContain(res.status);
    });

    it('operator cannot update member role', async () => {
      const res = await request(app)
        .put('/api/team/test-member-id/role')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator')
        .set('x-mfa-verified', 'true')
        .send({ role: 'viewer' });
      expect(res.status).toBe(403);
    });

    it('viewer cannot update member role', async () => {
      const res = await request(app)
        .put('/api/team/test-member-id/role')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer')
        .set('x-mfa-verified', 'true')
        .send({ role: 'operator' });
      expect(res.status).toBe(403);
    });
  });

  describe('Team Routes (DELETE /api/team/:memberId) — remove member', () => {
    const app = createApp('/api/team', teamRoutes);

    it('owner can remove members', async () => {
      const res = await request(app)
        .delete('/api/team/test-member-id')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner');
      expect([200, 400, 404, 500]).toContain(res.status);
    });

    it('operator can remove members', async () => {
      const res = await request(app)
        .delete('/api/team/test-member-id')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator');
      expect([200, 400, 404, 500]).toContain(res.status);
    });

    it('viewer cannot remove members', async () => {
      const res = await request(app)
        .delete('/api/team/test-member-id')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer');
      expect(res.status).toBe(403);
    });
  });

  describe('Team Routes (PATCH /api/team/slack-webhook) — manage webhooks', () => {
    const app = createApp('/api/team', teamRoutes);

    it('owner can manage webhooks', async () => {
      const res = await request(app)
        .patch('/api/team/slack-webhook')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .send({ slack_webhook_url: 'https://hooks.slack.com/services/test' });
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator can manage webhooks', async () => {
      const res = await request(app)
        .patch('/api/team/slack-webhook')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator')
        .send({ slack_webhook_url: 'https://hooks.slack.com/services/test' });
      expect([200, 400, 500]).toContain(res.status);
    });

    it('viewer cannot manage webhooks', async () => {
      const res = await request(app)
        .patch('/api/team/slack-webhook')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer')
        .send({ slack_webhook_url: 'https://hooks.slack.com/services/test' });
      expect(res.status).toBe(403);
    });
  });

  describe('Payment Channel Routes — Funding (POST /api/payment-channels/fund)', () => {
    const app = createApp('/api/payment-channels', paymentChannelsRoutes);

    it('owner can fund channels (with MFA)', async () => {
      const res = await request(app)
        .post('/api/payment-channels/fund')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .set('x-mfa-verified', 'true')
        .send({ amount: 100, counterparty: 'cp-1' });
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator cannot fund channels', async () => {
      const res = await request(app)
        .post('/api/payment-channels/fund')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator')
        .set('x-mfa-verified', 'true')
        .send({ amount: 100, counterparty: 'cp-1' });
      expect(res.status).toBe(403);
    });

    it('viewer cannot fund channels', async () => {
      const res = await request(app)
        .post('/api/payment-channels/fund')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer')
        .set('x-mfa-verified', 'true')
        .send({ amount: 100, counterparty: 'cp-1' });
      expect(res.status).toBe(403);
    });
  });

  describe('Payment Channel Routes — Grant Authority (POST /api/payment-channels/grant-authority)', () => {
    const app = createApp('/api/payment-channels', paymentChannelsRoutes);

    it('owner can grant authority (with MFA)', async () => {
      const res = await request(app)
        .post('/api/payment-channels/grant-authority')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .set('x-mfa-verified', 'true')
        .send({ agentId: 'agent-1', spendingLimit: 500 });
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator cannot grant authority', async () => {
      const res = await request(app)
        .post('/api/payment-channels/grant-authority')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator')
        .set('x-mfa-verified', 'true')
        .send({ agentId: 'agent-1', spendingLimit: 500 });
      expect(res.status).toBe(403);
    });

    it('owner denied without MFA re-authentication', async () => {
      const res = await request(app)
        .post('/api/payment-channels/grant-authority')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .send({ agentId: 'agent-1', spendingLimit: 500 });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('MFA Required');
    });
  });

  describe('Payment Channel Routes — Raise Cap (PATCH /api/payment-channels/cap)', () => {
    const app = createApp('/api/payment-channels', paymentChannelsRoutes);

    it('owner can raise cap (with MFA)', async () => {
      const res = await request(app)
        .patch('/api/payment-channels/cap')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .set('x-mfa-verified', 'true')
        .send({ newCap: 1000, agentId: 'agent-1' });
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator cannot raise cap', async () => {
      const res = await request(app)
        .patch('/api/payment-channels/cap')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator')
        .set('x-mfa-verified', 'true')
        .send({ newCap: 1000, agentId: 'agent-1' });
      expect(res.status).toBe(403);
    });

    it('owner denied without MFA re-authentication for cap raise', async () => {
      const res = await request(app)
        .patch('/api/payment-channels/cap')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .send({ newCap: 1000, agentId: 'agent-1' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('MFA Required');
    });
  });

  describe('Payment Channel Routes — Change Payout Address (PATCH /api/payment-channels/payout-address)', () => {
    const app = createApp('/api/payment-channels', paymentChannelsRoutes);

    it('owner can change payout address (with MFA)', async () => {
      const res = await request(app)
        .patch('/api/payment-channels/payout-address')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .set('x-mfa-verified', 'true')
        .send({ payoutAddress: 'GABCDEF1234567890' });
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator cannot change payout address', async () => {
      const res = await request(app)
        .patch('/api/payment-channels/payout-address')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator')
        .set('x-mfa-verified', 'true')
        .send({ payoutAddress: 'GABCDEF1234567890' });
      expect(res.status).toBe(403);
    });

    it('owner denied without MFA for payout address change', async () => {
      const res = await request(app)
        .patch('/api/payment-channels/payout-address')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .send({ payoutAddress: 'GABCDEF1234567890' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('MFA Required');
    });
  });

  describe('Payment Channel Routes — Close Channel (POST /api/payment-channels/:id/close)', () => {
    const app = createApp('/api/payment-channels', paymentChannelsRoutes);

    it('owner can close channel', async () => {
      const res = await request(app)
        .post('/api/payment-channels/test-channel-id/close')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner');
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator cannot close channel', async () => {
      const res = await request(app)
        .post('/api/payment-channels/test-channel-id/close')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator');
      expect(res.status).toBe(403);
    });

    it('viewer cannot close channel', async () => {
      const res = await request(app)
        .post('/api/payment-channels/test-channel-id/close')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer');
      expect(res.status).toBe(403);
    });
  });

  describe('Payment Channel Routes — Register Agents (POST /api/payment-channels/agents)', () => {
    const app = createApp('/api/payment-channels', paymentChannelsRoutes);

    it('owner can register agents', async () => {
      const res = await request(app)
        .post('/api/payment-channels/agents')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .send({ agentName: 'scout', pubKey: 'GABCDEF1234567890', cap: 100 });
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator can register agents within existing caps', async () => {
      const res = await request(app)
        .post('/api/payment-channels/agents')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator')
        .send({ agentName: 'scout', pubKey: 'GABCDEF1234567890', cap: 100 });
      expect([200, 400, 500]).toContain(res.status);
    });

    it('viewer cannot register agents', async () => {
      const res = await request(app)
        .post('/api/payment-channels/agents')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer')
        .send({ agentName: 'scout', pubKey: 'GABCDEF1234567890', cap: 100 });
      expect(res.status).toBe(403);
    });
  });

  describe('Payment Channel Routes — Read Usage (GET /api/payment-channels/usage)', () => {
    const app = createApp('/api/payment-channels', paymentChannelsRoutes);

    it('owner can read usage', async () => {
      const res = await request(app)
        .get('/api/payment-channels/usage')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner');
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator can read usage', async () => {
      const res = await request(app)
        .get('/api/payment-channels/usage')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator');
      expect([200, 400, 500]).toContain(res.status);
    });

    it('viewer can read usage', async () => {
      const res = await request(app)
        .get('/api/payment-channels/usage')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer');
      expect([200, 400, 500]).toContain(res.status);
    });
  });

  describe('Payment Channel Routes — Update Preferences (PATCH /api/payment-channels/preferences)', () => {
    const app = createApp('/api/payment-channels', paymentChannelsRoutes);

    it('owner can update preferences (with MFA)', async () => {
      const res = await request(app)
        .patch('/api/payment-channels/preferences')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .set('x-mfa-verified', 'true')
        .send({ autoTopUp: true, autoTopUpAmount: 50 });
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator cannot update preferences', async () => {
      const res = await request(app)
        .patch('/api/payment-channels/preferences')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator')
        .set('x-mfa-verified', 'true')
        .send({ autoTopUp: true, autoTopUpAmount: 50 });
      expect(res.status).toBe(403);
    });

    it('owner denied without MFA for preferences update', async () => {
      const res = await request(app)
        .patch('/api/payment-channels/preferences')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner')
        .send({ autoTopUp: true, autoTopUpAmount: 50 });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('MFA Required');
    });
  });

  describe('Payment Channel Routes — GET /preferences', () => {
    const app = createApp('/api/payment-channels', paymentChannelsRoutes);

    it('owner can view preferences', async () => {
      const res = await request(app)
        .get('/api/payment-channels/preferences')
        .set('x-test-role', 'owner')
        .set('x-team-role', 'owner');
      expect([200, 400, 500]).toContain(res.status);
    });

    it('operator can view preferences', async () => {
      const res = await request(app)
        .get('/api/payment-channels/preferences')
        .set('x-test-role', 'operator')
        .set('x-team-role', 'operator');
      expect([200, 400, 500]).toContain(res.status);
    });

    it('viewer can view preferences', async () => {
      const res = await request(app)
        .get('/api/payment-channels/preferences')
        .set('x-test-role', 'viewer')
        .set('x-team-role', 'viewer');
      expect([200, 400, 500]).toContain(res.status);
    });
  });
});
