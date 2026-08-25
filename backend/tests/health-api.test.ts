import request from 'supertest';
import express from 'express';
import { healthService } from '../src/services/health-service';
import { adminAuth } from '../src/middleware/admin';
import { dependencyHealthService } from '../src/services/dependency-health-service';

jest.mock('../src/services/health-service', () => ({
  healthService: {
    getAdminHealth: jest.fn(),
  },
}));

jest.mock('../src/services/dependency-health-service', () => ({
  dependencyHealthService: {
    getLiveness: jest.fn(),
    getReadiness: jest.fn(),
  },
}));

jest.mock('../src/config/logger');

const app = express();

app.get('/health/live', (req, res) => {
  const status = dependencyHealthService.getLiveness();
  res.status(200).json(status);
});

app.get('/health/ready', async (req, res) => {
  try {
    const status = await dependencyHealthService.getReadiness();
    const httpStatus = status.status === 'ready' ? 200 : 503;
    res.status(httpStatus).json(status);
  } catch {
    res.status(503).json({ status: 'not_ready', timestamp: new Date().toISOString(), message: 'Readiness check failed' });
  }
});

app.get('/api/admin/health', adminAuth, async (req, res) => {
  try {
    const includeHistory = req.query.history !== 'false';
    const health = await healthService.getAdminHealth(includeHistory);
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch health status' });
  }
});

describe('GET /health/live', () => {
  it('returns 200 with alive status', async () => {
    (dependencyHealthService.getLiveness as jest.Mock).mockReturnValue({
      status: 'alive',
      timestamp: '2026-06-27T00:00:00.000Z',
      uptime_ms: 1000,
    });

    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('alive');
    expect(response.body.uptime_ms).toBeDefined();
    expect(response.body.timestamp).toBeDefined();
  });

  it('requires no authentication', async () => {
    (dependencyHealthService.getLiveness as jest.Mock).mockReturnValue({
      status: 'alive',
      timestamp: '2026-06-27T00:00:00.000Z',
      uptime_ms: 500,
    });

    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when all critical dependencies are healthy', async () => {
    (dependencyHealthService.getReadiness as jest.Mock).mockResolvedValue({
      status: 'ready',
      timestamp: '2026-06-27T00:00:00.000Z',
      message: 'All critical dependencies healthy',
      dependencies: [
        { name: 'database', status: 'healthy', latency_ms: 5 },
        { name: 'redis', status: 'healthy', latency_ms: 2 },
        { name: 'queue', status: 'healthy', latency_ms: 1 },
        { name: 'providers', status: 'healthy', latency_ms: 0 },
        { name: 'rpc_horizon', status: 'healthy', latency_ms: 10 },
        { name: 'fx_provider', status: 'healthy', latency_ms: 8 },
        { name: 'scheduler', status: 'healthy' },
      ],
    });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.dependencies).toHaveLength(7);
    expect(response.body.dependencies.find((d: { name: string }) => d.name === 'rpc_horizon')).toBeDefined();
    expect(response.body.dependencies.find((d: { name: string }) => d.name === 'fx_provider')).toBeDefined();
    expect(response.body.dependencies.find((d: { name: string }) => d.name === 'scheduler')).toBeDefined();
  });

  it('returns 503 when a critical dependency is unhealthy', async () => {
    (dependencyHealthService.getReadiness as jest.Mock).mockResolvedValue({
      status: 'not_ready',
      timestamp: '2026-06-27T00:00:00.000Z',
      message: 'Critical dependencies unhealthy: database',
      dependencies: [
        { name: 'database', status: 'unhealthy', latency_ms: 30, error: 'Connection timeout' },
        { name: 'redis', status: 'healthy', latency_ms: 2 },
        { name: 'queue', status: 'healthy', latency_ms: 1 },
        { name: 'providers', status: 'healthy', latency_ms: 0 },
        { name: 'scheduler', status: 'healthy' },
      ],
    });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.message).toContain('database');
    const db = response.body.dependencies.find((d: { name: string }) => d.name === 'database');
    expect(db.status).toBe('unhealthy');
    expect(db.error).toBe('Connection timeout');
  });

  it('returns 200 with degraded message when optional deps are degraded', async () => {
    (dependencyHealthService.getReadiness as jest.Mock).mockResolvedValue({
      status: 'ready',
      timestamp: '2026-06-27T00:00:00.000Z',
      message: 'Some dependencies degraded: redis, scheduler',
      dependencies: [
        { name: 'database', status: 'healthy', latency_ms: 5 },
        { name: 'redis', status: 'degraded', latency_ms: 0, error: 'Redis not configured' },
        { name: 'queue', status: 'degraded', latency_ms: 0, error: 'Redis not configured; queue unavailable' },
        { name: 'providers', status: 'degraded', latency_ms: 0, error: 'Missing: stripe, gmail' },
        { name: 'scheduler', status: 'degraded', error: 'Scheduler not started' },
      ],
    });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.message).toContain('degraded');
  });

  it('returns 503 when getReadiness throws', async () => {
    (dependencyHealthService.getReadiness as jest.Mock).mockRejectedValue(new Error('Unexpected'));

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
  });

  it('requires no authentication', async () => {
    (dependencyHealthService.getReadiness as jest.Mock).mockResolvedValue({
      status: 'ready',
      timestamp: '2026-06-27T00:00:00.000Z',
      message: 'All critical dependencies healthy',
      dependencies: [],
    });

    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(200);
  });

  it('liveness and readiness are distinct endpoints', async () => {
    (dependencyHealthService.getLiveness as jest.Mock).mockReturnValue({
      status: 'alive',
      timestamp: '2026-06-27T00:00:00.000Z',
      uptime_ms: 1000,
    });
    (dependencyHealthService.getReadiness as jest.Mock).mockResolvedValue({
      status: 'not_ready',
      timestamp: '2026-06-27T00:00:00.000Z',
      message: 'Critical dependencies unhealthy: database',
      dependencies: [{ name: 'database', status: 'unhealthy', error: 'down' }],
    });

    const liveRes = await request(app).get('/health/live');
    const readyRes = await request(app).get('/health/ready');

    // liveness always 200 even when readiness fails
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.status).toBe('alive');
    expect(readyRes.status).toBe(503);
    expect(readyRes.body.status).toBe('not_ready');
  });
});

describe('Admin Health API', () => {
  it('should return 401 if x-admin-api-key is missing', async () => {
    const response = await request(app).get('/api/admin/health');
    expect(response.status).toBe(401);
  });

  it('should return 403 if x-admin-api-key is incorrect', async () => {
    const response = await request(app)
      .get('/api/admin/health')
      .set('x-admin-api-key', 'wrong-key');
    expect(response.status).toBe(403);
  });

  it('should return 200 and health payload when healthy', async () => {
    (healthService.getAdminHealth as jest.Mock).mockResolvedValue({
      status: 'healthy',
      timestamp: '2025-01-01T00:00:00.000Z',
      metrics: {
        failedRenewalsLastHour: 0,
        contractErrorsLastHour: 0,
        lastAgentActivityAt: new Date().toISOString(),
        pendingReminders: 0,
        processedRemindersLast24h: 10,
      },
      alerts: [],
      thresholds: {
        failedRenewalsPerHour: 10,
        contractErrorsPerHour: 5,
        agentInactivityHours: 24,
      },
      history: [],
    });

    const response = await request(app)
      .get('/api/admin/health')
      .set('x-admin-api-key', process.env.ADMIN_API_KEY!);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.metrics).toBeDefined();
    expect(response.body.alerts).toEqual([]);
    expect(response.body.thresholds).toBeDefined();
  });

  it('should return 503 when status is unhealthy', async () => {
    (healthService.getAdminHealth as jest.Mock).mockResolvedValue({
      status: 'unhealthy',
      timestamp: '2025-01-01T00:00:00.000Z',
      metrics: { failedRenewalsLastHour: 20, contractErrorsLastHour: 8 },
      alerts: [
        {
          id: 'failed_renewals',
          message: 'Failed renewals exceed threshold',
          severity: 'critical',
          value: 20,
          threshold: 10,
          triggeredAt: new Date().toISOString(),
        },
      ],
      thresholds: {},
      history: [],
    });

    const response = await request(app)
      .get('/api/admin/health')
      .set('x-admin-api-key', process.env.ADMIN_API_KEY!);

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.alerts).toHaveLength(1);
    expect(response.body.alerts[0].id).toBe('failed_renewals');
  });

  it('should pass history=false to getAdminHealth when query param is set', async () => {
    (healthService.getAdminHealth as jest.Mock).mockResolvedValue({
      status: 'healthy',
      timestamp: '2025-01-01T00:00:00.000Z',
      metrics: {},
      alerts: [],
      thresholds: {},
    });

    await request(app)
      .get('/api/admin/health?history=false')
      .set('x-admin-api-key', process.env.ADMIN_API_KEY!);

    expect(healthService.getAdminHealth).toHaveBeenCalledWith(false);
  });
});
