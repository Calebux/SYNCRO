/**
 * Cross-tenant leakage tests for V3 analytics endpoints.
 *
 * Ensures that:
 * 1. A principal can only access their own analytics data.
 * 2. The operator endpoint requires owner/admin role.
 * 3. No endpoint leaks another principal's usage data.
 */

import request from 'supertest';
import express from 'express';
import analyticsV3Router from '../src/routes/analytics-v3';
import { authenticate } from '../src/middleware/auth';
import { requireRole } from '../src/middleware/rbac';

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn(),
}));

jest.mock('../src/middleware/rbac', () => ({
  requireRole: jest.fn((...roles: string[]) => {
    return (req: any, _res: any, next: any) => {
      req.user = { id: 'operator-user-id', role: 'admin' };
      next();
    };
  }),
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/services/analytics-v3-service', () => ({
  analyticsV3Service: {
    getPrincipalAnalytics: jest.fn(),
    getOperatorAnalytics: jest.fn(),
  },
}));

const { analyticsV3Service } = require('../src/services/analytics-v3-service');

const app = express();
app.use(express.json());
app.use('/api/analytics/v3', analyticsV3Router);

describe('V3 Analytics Cross-Tenant Isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/analytics/v3/usage', () => {
    it('should return 401 when no user is authenticated', async () => {
      (authenticate as jest.Mock).mockImplementation((req, _res, next) => {
        req.user = null;
        next();
      });

      const res = await request(app).get('/api/analytics/v3/usage');
      expect(res.status).toBe(401);
    });

    it('should return 200 and principal analytics for the authenticated user', async () => {
      (authenticate as jest.Mock).mockImplementation((req, _res, next) => {
        req.user = { id: 'principal-a', role: 'member' };
        next();
      });

      analyticsV3Service.getPrincipalAnalytics.mockResolvedValue({
        callsMetered: 42,
        valueSettled: 100.5,
        valueUnsettled: 25.0,
        activeChannels: 3,
        capUtilizationPerAgent: [],
        routeMix: [],
        rejectionReasonsByCategory: [],
        period: {
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-01-31T00:00:00.000Z',
          granularity: 'day',
        },
      });

      const res = await request(app).get('/api/analytics/v3/usage');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(analyticsV3Service.getPrincipalAnalytics).toHaveBeenCalledWith('principal-a', expect.any(Object));
    });

    it('should never pass another principal\'s userId to the service', async () => {
      (authenticate as jest.Mock).mockImplementation((req, _res, next) => {
        req.user = { id: 'principal-a', role: 'member' };
        next();
      });

      analyticsV3Service.getPrincipalAnalytics.mockResolvedValue({
        callsMetered: 0,
        valueSettled: 0,
        valueUnsettled: 0,
        activeChannels: 0,
        capUtilizationPerAgent: [],
        routeMix: [],
        rejectionReasonsByCategory: [],
        period: {
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-01-31T00:00:00.000Z',
          granularity: 'day',
        },
      });

      // Even if a malicious request tries to specify another user,
      // the service should only use the authenticated user's ID.
      await request(app)
        .get('/api/analytics/v3/usage')
        .query({ userId: 'principal-b' });

      expect(analyticsV3Service.getPrincipalAnalytics).toHaveBeenCalledWith('principal-a', expect.any(Object));
      expect(analyticsV3Service.getPrincipalAnalytics).not.toHaveBeenCalledWith('principal-b', expect.any(Object));
    });

    it('should return 400 for invalid date range', async () => {
      (authenticate as jest.Mock).mockImplementation((req, _res, next) => {
        req.user = { id: 'principal-a', role: 'member' };
        next();
      });

      const res = await request(app)
        .get('/api/analytics/v3/usage')
        .query({ from: 'invalid-date', to: '2026-01-31T00:00:00.000Z' });

      expect(res.status).toBe(400);
    });

    it('should return 400 when start date is after end date', async () => {
      (authenticate as jest.Mock).mockImplementation((req, _res, next) => {
        req.user = { id: 'principal-a', role: 'member' };
        next();
      });

      const res = await request(app)
        .get('/api/analytics/v3/usage')
        .query({ from: '2026-06-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/analytics/v3/operator/usage', () => {
    it('should return 403 when a non-operator (member/viewer) calls the endpoint', async () => {
      (authenticate as jest.Mock).mockImplementation((req, _res, next) => {
        req.user = { id: 'principal-a', role: 'member' };
        next();
      });

      // requireRole('owner', 'admin') should reject non-operator roles
      const { requireRole } = require('../src/middleware/rbac');
      requireRole.mockImplementation((...roles: string[]) => {
        return (req: any, res: any, next: any) => {
          if (!roles.includes(req.user.role)) {
            res.status(403).json({ error: 'Forbidden' });
            return;
          }
          next();
        };
      });

      const res = await request(app).get('/api/analytics/v3/operator/usage');
      expect(res.status).toBe(403);
    });

    it('should return 200 and operator analytics for owner/admin', async () => {
      (authenticate as jest.Mock).mockImplementation((req, _res, next) => {
        req.user = { id: 'operator-user-id', role: 'admin' };
        next();
      });

      analyticsV3Service.getOperatorAnalytics.mockResolvedValue({
        totalCallsMetered: 1000,
        totalValueSettled: 5000.0,
        totalValueUnsettled: 1200.0,
        totalActiveChannels: 50,
        aggregateCapUtilization: [],
        globalRouteMix: [],
        globalRejectionReasonsByCategory: [],
        topPrincipalsByCalls: [],
        topPrincipalsByValueSettled: [],
        period: {
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-01-31T00:00:00.000Z',
          granularity: 'day',
        },
      });

      const res = await request(app).get('/api/analytics/v3/operator/usage');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(analyticsV3Service.getOperatorAnalytics).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should not expose another principal\'s detailed data in operator response', async () => {
      (authenticate as jest.Mock).mockImplementation((req, _res, next) => {
        req.user = { id: 'operator-user-id', role: 'owner' };
        next();
      });

      // Operator analytics aggregates across all principals but does not
      // return individual principal usage data — only top-N summaries.
      analyticsV3Service.getOperatorAnalytics.mockResolvedValue({
        totalCallsMetered: 1000,
        totalValueSettled: 5000.0,
        totalValueUnsettled: 1200.0,
        totalActiveChannels: 50,
        aggregateCapUtilization: [
          { agentId: 'agent-1', agentName: 'Principal abc123', currentBalance: 500, capacity: 1000, utilizationPercentage: 50 },
        ],
        globalRouteMix: [],
        globalRejectionReasonsByCategory: [],
        topPrincipalsByCalls: [
          { principalId: 'principal-a', principalName: 'principal-a', value: 100 },
        ],
        topPrincipalsByValueSettled: [
          { principalId: 'principal-b', principalName: 'principal-b', value: 2000 },
        ],
        period: {
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-01-31T00:00:00.000Z',
          granularity: 'day',
        },
      });

      const res = await request(app).get('/api/analytics/v3/operator/usage');
      expect(res.status).toBe(200);
      // The response should contain aggregate data, not per-principal details
      expect(res.body.data.topPrincipalsByCalls).toBeDefined();
      expect(res.body.data.topPrincipalsByCalls).toHaveLength(1);
      // Verify that the top principals list only contains IDs and aggregated values,
      // not full usage data for any single principal
      const topPrincipal = res.body.data.topPrincipalsByCalls[0];
      expect(topPrincipal).toHaveProperty('principalId');
      expect(topPrincipal).toHaveProperty('value');
      expect(topPrincipal).not.toHaveProperty('callsMetered');
      expect(topPrincipal).not.toHaveProperty('valueSettled');
    });
  });
});
