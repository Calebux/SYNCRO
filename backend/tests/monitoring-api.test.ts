import request from 'supertest';
import express from 'express';
import { monitoringService } from '../src/services/monitoring-service';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../src/services/monitoring-service', () => ({
  monitoringService: {
    getSubscriptionMetrics: jest.fn(),
    getRenewalMetrics: jest.fn(),
    getAgentActivity: jest.fn(),
    getTrialMetrics: jest.fn(),
    getThroughputMetrics: jest.fn(),
    getLatencyMetrics: jest.fn(),
    getRetryMetrics: jest.fn(),
    getFailedItems: jest.fn(),
    getPoolMetrics: jest.fn(),
    getApiLatencyMetrics: jest.fn(),
  },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

// ─── Minimal test app (mirrors src/index.ts admin routes) ────────────────────

const ADMIN_API_KEY = 'test-admin-key';

const adminAuth = (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-admin-api-key'];
  if (!apiKey || apiKey !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin API key' });
  }
  next();
};

const app = express();
app.use(express.json());

// ── Existing endpoints ────────────────────────────────────────────────────────

app.get('/api/admin/metrics/subscriptions', adminAuth, async (_req, res) => {
  try {
    const metrics = await monitoringService.getSubscriptionMetrics();
    res.json(metrics);
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/admin/metrics/renewals', adminAuth, async (_req, res) => {
  try {
    const metrics = await monitoringService.getRenewalMetrics();
    res.json(metrics);
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/admin/metrics/activity', adminAuth, async (_req, res) => {
  try {
    const metrics = await monitoringService.getAgentActivity();
    res.json(metrics);
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
});

// ── Issue #99: new endpoints ──────────────────────────────────────────────────

app.get('/api/admin/metrics/throughput', adminAuth, async (req, res) => {
  try {
    const windowHours = parseInt(req.query.window as string) || 24;
    if (windowHours < 1 || windowHours > 720) {
      return res.status(400).json({ error: 'window must be between 1 and 720 hours' });
    }
    const metrics = await monitoringService.getThroughputMetrics(windowHours);
    res.json(metrics);
  } catch {
    res.status(500).json({ error: 'Failed to fetch throughput metrics' });
  }
});

app.get('/api/admin/metrics/latency', adminAuth, async (req, res) => {
  try {
    const windowHours = parseInt(req.query.window as string) || 24;
    if (windowHours < 1 || windowHours > 720) {
      return res.status(400).json({ error: 'window must be between 1 and 720 hours' });
    }
    const metrics = await monitoringService.getLatencyMetrics(windowHours);
    res.json(metrics);
  } catch {
    res.status(500).json({ error: 'Failed to fetch latency metrics' });
  }
});

app.get('/api/admin/metrics/retries', adminAuth, async (req, res) => {
  try {
    const windowHours = parseInt(req.query.window as string) || 24;
    if (windowHours < 1 || windowHours > 720) {
      return res.status(400).json({ error: 'window must be between 1 and 720 hours' });
    }
    const metrics = await monitoringService.getRetryMetrics(windowHours);
    res.json(metrics);
  } catch {
    res.status(500).json({ error: 'Failed to fetch retry metrics' });
  }
});

app.get('/api/admin/metrics/failed-items', adminAuth, async (req, res) => {
  try {
    const type = req.query.type as string;
    if (!type || !['reminder', 'renewal', 'blockchain'].includes(type)) {
      return res.status(400).json({
        error: 'type is required and must be one of: reminder, renewal, blockchain',
      });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await monitoringService.getFailedItems(
      type as 'reminder' | 'renewal' | 'blockchain',
      limit,
      offset,
    );
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch failed items' });
  }
});

app.get('/api/admin/metrics/api-latency', adminAuth, async (_req, res) => {
  try {
    const metrics = await monitoringService.getApiLatencyMetrics();
    res.json(metrics);
  } catch {
    res.status(500).json({ error: 'Failed to fetch API latency metrics' });
  }
});

app.get('/api/admin/metrics/ops-summary', adminAuth, async (req, res) => {
  try {
    const windowHours = parseInt(req.query.window as string) || 24;
    if (windowHours < 1 || windowHours > 720) {
      return res.status(400).json({ error: 'window must be between 1 and 720 hours' });
    }
    const [subscriptions, renewals, activity, trials, throughput, latency, retries, apiLatency] =
      await Promise.all([
        monitoringService.getSubscriptionMetrics(),
        monitoringService.getRenewalMetrics(),
        monitoringService.getAgentActivity(),
        monitoringService.getTrialMetrics(),
        monitoringService.getThroughputMetrics(windowHours),
        monitoringService.getLatencyMetrics(windowHours),
        monitoringService.getRetryMetrics(windowHours),
        monitoringService.getApiLatencyMetrics(),
      ]);
    res.json({
      generated_at: new Date().toISOString(),
      window_hours: windowHours,
      subscriptions,
      renewals,
      activity,
      trials,
      throughput,
      latency,
      retries,
      api_latency: apiLatency,
      db_pool: monitoringService.getPoolMetrics(),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch ops summary' });
  }
});

// ─── Test suites ──────────────────────────────────────────────────────────────

const AUTH = { 'x-admin-api-key': 'test-admin-key' };
const WRONG_AUTH = { 'x-admin-api-key': 'wrong-key' };

// ── GET /api/admin/metrics/api-latency ───────────────────────────────────────

describe('GET /api/admin/metrics/api-latency', () => {
  const API_LATENCY_FIXTURE = [
    {
      family: 'GET /subscriptions',
      p50_ms: 50,
      p95_ms: 150,
      p99_ms: 300,
      avg_ms: 75,
      sample_count: 100,
    },
    {
      family: 'POST /webhooks',
      p50_ms: 100,
      p95_ms: 200,
      p99_ms: 400,
      avg_ms: 120,
      sample_count: 50,
    },
  ];

  it('returns 401 without auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/api-latency');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong auth key', async () => {
    const res = await request(app)
      .get('/api/admin/metrics/api-latency')
      .set(WRONG_AUTH);
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct shape', async () => {
    (monitoringService.getApiLatencyMetrics as jest.Mock).mockResolvedValue(API_LATENCY_FIXTURE);

    const res = await request(app).get('/api/admin/metrics/api-latency').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].family).toBe('GET /subscriptions');
    expect(res.body[0].p50_ms).toBe(50);
    expect(res.body[0].sample_count).toBe(100);
  });

  it('returns 500 when service throws', async () => {
    (monitoringService.getApiLatencyMetrics as jest.Mock).mockRejectedValue(new Error('fail'));

    const res = await request(app).get('/api/admin/metrics/api-latency').set(AUTH);
    expect(res.status).toBe(500);
  });
});

// ── Original access-control suite ────────────────────────────────────────────

describe('Monitoring API Access Control', () => {
  it('should return 401 if x-admin-api-key is missing', async () => {
    const response = await request(app).get('/api/admin/metrics/subscriptions');
    expect(response.status).toBe(401);
  });

  it('should return 401 if x-admin-api-key is incorrect', async () => {
    const response = await request(app)
      .get('/api/admin/metrics/subscriptions')
      .set(WRONG_AUTH);
    expect(response.status).toBe(401);
  });

  it('should return 200 and data if x-admin-api-key is correct', async () => {
    (monitoringService.getSubscriptionMetrics as jest.Mock).mockResolvedValue({
      total_subscriptions: 10,
    });

    const response = await request(app)
      .get('/api/admin/metrics/subscriptions')
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body.total_subscriptions).toBe(10);
  });
});

// ── GET /api/admin/metrics/throughput ─────────────────────────────────────────

describe('GET /api/admin/metrics/throughput', () => {
  const THROUGHPUT_FIXTURE = {
    window_hours: 24,
    window_start: '2026-05-25T19:00:00.000Z',
    reminders_processed: 42,
    notification_deliveries_total: 130,
    deliveries_by_channel: { email: 90, push: 30, telegram: 10 },
    renewals_executed: 15,
    renewals_by_status: { success: 12, failed: 3 },
    blockchain_events: 20,
  };

  it('returns 401 without auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/throughput');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/throughput').set(WRONG_AUTH);
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct auth key and default window', async () => {
    (monitoringService.getThroughputMetrics as jest.Mock).mockResolvedValue(THROUGHPUT_FIXTURE);

    const res = await request(app).get('/api/admin/metrics/throughput').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.reminders_processed).toBe(42);
    expect(res.body.notification_deliveries_total).toBe(130);
    expect(monitoringService.getThroughputMetrics).toHaveBeenCalledWith(24);
  });

  it('accepts custom window query param', async () => {
    (monitoringService.getThroughputMetrics as jest.Mock).mockResolvedValue(THROUGHPUT_FIXTURE);

    await request(app).get('/api/admin/metrics/throughput?window=48').set(AUTH);

    expect(monitoringService.getThroughputMetrics).toHaveBeenCalledWith(48);
  });

  it('returns 400 for window out of range', async () => {
    const res = await request(app).get('/api/admin/metrics/throughput?window=999').set(AUTH);
    expect(res.status).toBe(400);
  });

  it('returns 500 when service throws', async () => {
    (monitoringService.getThroughputMetrics as jest.Mock).mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/api/admin/metrics/throughput').set(AUTH);
    expect(res.status).toBe(500);
  });
});

// ── GET /api/admin/metrics/latency ────────────────────────────────────────────

describe('GET /api/admin/metrics/latency', () => {
  const LATENCY_FIXTURE = {
    window_hours: 24,
    window_start: '2026-05-25T19:00:00.000Z',
    notification_delivery_latency: { p50_ms: 120, p95_ms: 450, p99_ms: 900, avg_ms: 200, sample_count: 300 },
    renewal_execution_latency: { p50_ms: 800, p95_ms: 2000, p99_ms: 5000, avg_ms: 1000, sample_count: 50 },
  };

  it('returns 401 without auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/latency');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/latency').set(WRONG_AUTH);
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct shape', async () => {
    (monitoringService.getLatencyMetrics as jest.Mock).mockResolvedValue(LATENCY_FIXTURE);

    const res = await request(app).get('/api/admin/metrics/latency').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.notification_delivery_latency.p50_ms).toBe(120);
    expect(res.body.renewal_execution_latency.p99_ms).toBe(5000);
  });

  it('accepts custom window query param', async () => {
    (monitoringService.getLatencyMetrics as jest.Mock).mockResolvedValue(LATENCY_FIXTURE);

    await request(app).get('/api/admin/metrics/latency?window=72').set(AUTH);

    expect(monitoringService.getLatencyMetrics).toHaveBeenCalledWith(72);
  });

  it('returns 400 for window = 0', async () => {
    const res = await request(app).get('/api/admin/metrics/latency?window=0').set(AUTH);
    expect(res.status).toBe(400);
  });

  it('returns 500 when service throws', async () => {
    (monitoringService.getLatencyMetrics as jest.Mock).mockRejectedValue(new Error('fail'));

    const res = await request(app).get('/api/admin/metrics/latency').set(AUTH);
    expect(res.status).toBe(500);
  });
});

// ── GET /api/admin/metrics/retries ────────────────────────────────────────────

describe('GET /api/admin/metrics/retries', () => {
  const RETRY_FIXTURE = {
    window_hours: 24,
    window_start: '2026-05-25T19:00:00.000Z',
    total_retried: 18,
    max_retries_hit: 4,
    retry_rate_pct: 45.0,
    attempt_distribution: { 1: 80, 2: 14, 3: 4 },
    retries_by_channel: {
      email: { retried: 10, max_hit: 2 },
      push: { retried: 8, max_hit: 2 },
    },
  };

  it('returns 401 without auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/retries');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/retries').set(WRONG_AUTH);
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct shape', async () => {
    (monitoringService.getRetryMetrics as jest.Mock).mockResolvedValue(RETRY_FIXTURE);

    const res = await request(app).get('/api/admin/metrics/retries').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.total_retried).toBe(18);
    expect(res.body.max_retries_hit).toBe(4);
    expect(res.body.retry_rate_pct).toBe(45.0);
    expect(res.body.retries_by_channel.email.max_hit).toBe(2);
  });

  it('accepts custom window query param', async () => {
    (monitoringService.getRetryMetrics as jest.Mock).mockResolvedValue(RETRY_FIXTURE);

    await request(app).get('/api/admin/metrics/retries?window=168').set(AUTH);

    expect(monitoringService.getRetryMetrics).toHaveBeenCalledWith(168);
  });

  it('returns 400 for window > 720', async () => {
    const res = await request(app).get('/api/admin/metrics/retries?window=721').set(AUTH);
    expect(res.status).toBe(400);
  });

  it('returns 500 when service throws', async () => {
    (monitoringService.getRetryMetrics as jest.Mock).mockRejectedValue(new Error('fail'));

    const res = await request(app).get('/api/admin/metrics/retries').set(AUTH);
    expect(res.status).toBe(500);
  });
});

// ── GET /api/admin/metrics/failed-items ───────────────────────────────────────

describe('GET /api/admin/metrics/failed-items', () => {
  const FAILED_ITEMS_FIXTURE = {
    type: 'reminder',
    total: 5,
    limit: 20,
    offset: 0,
    items: [
      {
        id: 'del-1',
        type: 'reminder',
        status: 'failed',
        channel: 'email',
        attempt_count: 3,
        error_message: 'SMTP timeout',
        subscription_id: 'sub-1',
        user_id: 'usr-1',
        created_at: '2026-05-01T00:00:00Z',
      },
    ],
  };

  it('returns 401 without auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/failed-items?type=reminder');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong auth key', async () => {
    const res = await request(app)
      .get('/api/admin/metrics/failed-items?type=reminder')
      .set(WRONG_AUTH);
    expect(res.status).toBe(401);
  });

  it('returns 400 when type param is missing', async () => {
    const res = await request(app).get('/api/admin/metrics/failed-items').set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type is required/);
  });

  it('returns 400 when type param is invalid', async () => {
    const res = await request(app)
      .get('/api/admin/metrics/failed-items?type=webhook')
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  it('returns 200 with reminder type', async () => {
    (monitoringService.getFailedItems as jest.Mock).mockResolvedValue(FAILED_ITEMS_FIXTURE);

    const res = await request(app)
      .get('/api/admin/metrics/failed-items?type=reminder')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('reminder');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].error_message).toBe('SMTP timeout');
    expect(monitoringService.getFailedItems).toHaveBeenCalledWith('reminder', 20, 0);
  });

  it('returns 200 with renewal type', async () => {
    (monitoringService.getFailedItems as jest.Mock).mockResolvedValue({
      ...FAILED_ITEMS_FIXTURE,
      type: 'renewal',
    });

    const res = await request(app)
      .get('/api/admin/metrics/failed-items?type=renewal')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(monitoringService.getFailedItems).toHaveBeenCalledWith('renewal', 20, 0);
  });

  it('returns 200 with blockchain type', async () => {
    (monitoringService.getFailedItems as jest.Mock).mockResolvedValue({
      ...FAILED_ITEMS_FIXTURE,
      type: 'blockchain',
    });

    const res = await request(app)
      .get('/api/admin/metrics/failed-items?type=blockchain')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(monitoringService.getFailedItems).toHaveBeenCalledWith('blockchain', 20, 0);
  });

  it('passes limit and offset to service', async () => {
    (monitoringService.getFailedItems as jest.Mock).mockResolvedValue({
      ...FAILED_ITEMS_FIXTURE,
      limit: 10,
      offset: 30,
    });

    await request(app)
      .get('/api/admin/metrics/failed-items?type=reminder&limit=10&offset=30')
      .set(AUTH);

    expect(monitoringService.getFailedItems).toHaveBeenCalledWith('reminder', 10, 30);
  });

  it('caps limit at 100', async () => {
    (monitoringService.getFailedItems as jest.Mock).mockResolvedValue(FAILED_ITEMS_FIXTURE);

    await request(app)
      .get('/api/admin/metrics/failed-items?type=reminder&limit=500')
      .set(AUTH);

    expect(monitoringService.getFailedItems).toHaveBeenCalledWith('reminder', 100, 0);
  });

  it('returns 500 when service throws', async () => {
    (monitoringService.getFailedItems as jest.Mock).mockRejectedValue(new Error('DB fail'));

    const res = await request(app)
      .get('/api/admin/metrics/failed-items?type=reminder')
      .set(AUTH);
    expect(res.status).toBe(500);
  });
});

// ── GET /api/admin/metrics/ops-summary ───────────────────────────────────────

describe('GET /api/admin/metrics/ops-summary', () => {
  const defaultMocks = () => {
    (monitoringService.getSubscriptionMetrics as jest.Mock).mockResolvedValue({ total_subscriptions: 5 });
    (monitoringService.getRenewalMetrics as jest.Mock).mockResolvedValue({ success_rate: 90 });
    (monitoringService.getAgentActivity as jest.Mock).mockResolvedValue({ pending_reminders: 3 });
    (monitoringService.getTrialMetrics as jest.Mock).mockResolvedValue({ active_trials: 2 });
    (monitoringService.getThroughputMetrics as jest.Mock).mockResolvedValue({ reminders_processed: 10 });
    (monitoringService.getLatencyMetrics as jest.Mock).mockResolvedValue({ notification_delivery_latency: { p50_ms: 100 } });
    (monitoringService.getRetryMetrics as jest.Mock).mockResolvedValue({ total_retried: 1 });
    (monitoringService.getPoolMetrics as jest.Mock).mockReturnValue({ activeConnections: 0 });
    (monitoringService.getApiLatencyMetrics as jest.Mock).mockResolvedValue([
      { family: 'GET /subscriptions', p50_ms: 50, sample_count: 10 },
    ]);
  };

  it('returns 401 without auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/ops-summary');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong auth key', async () => {
    const res = await request(app).get('/api/admin/metrics/ops-summary').set(WRONG_AUTH);
    expect(res.status).toBe(401);
  });

  it('returns 200 with unified snapshot containing all metric groups', async () => {
    defaultMocks();

    const res = await request(app).get('/api/admin/metrics/ops-summary').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('generated_at');
    expect(res.body).toHaveProperty('subscriptions');
    expect(res.body).toHaveProperty('renewals');
    expect(res.body).toHaveProperty('activity');
    expect(res.body).toHaveProperty('trials');
    expect(res.body).toHaveProperty('throughput');
    expect(res.body).toHaveProperty('latency');
    expect(res.body).toHaveProperty('retries');
    expect(res.body).toHaveProperty('api_latency');
    expect(res.body).toHaveProperty('db_pool');
    expect(res.body.subscriptions.total_subscriptions).toBe(5);
    expect(res.body.api_latency).toHaveLength(1);
  });

  it('accepts custom window query param and passes it to all sub-metrics', async () => {
    defaultMocks();

    await request(app).get('/api/admin/metrics/ops-summary?window=168').set(AUTH);

    expect(monitoringService.getThroughputMetrics).toHaveBeenCalledWith(168);
    expect(monitoringService.getLatencyMetrics).toHaveBeenCalledWith(168);
    expect(monitoringService.getRetryMetrics).toHaveBeenCalledWith(168);
  });

  it('returns 400 for invalid window', async () => {
    const res = await request(app).get('/api/admin/metrics/ops-summary?window=0').set(AUTH);
    expect(res.status).toBe(400);
  });

  it('returns 500 when any sub-metric service throws', async () => {
    (monitoringService.getSubscriptionMetrics as jest.Mock).mockRejectedValue(new Error('fail'));

    const res = await request(app).get('/api/admin/metrics/ops-summary').set(AUTH);
    expect(res.status).toBe(500);
  });
});
