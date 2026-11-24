import request from 'supertest';
import express from 'express';
import analyticsRouter from '../src/routes/analytics';
import { analyticsService } from '../src/services/analytics-service';
import { authenticate } from '../src/middleware/auth';

jest.mock('../src/services/analytics-service', () => ({
  analyticsService: {
    getSummary: jest.fn(),
    getSpending: jest.fn(),
    getForecast: jest.fn(),
    getUserBudgets: jest.fn(),
  },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'test-user-id' };
    next();
  }),
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

const app = express();
app.use(express.json());
app.use('/api/analytics', analyticsRouter);

const mockSpending = {
  current_month_spend: 89.97,
  monthly_trend: [
    { month: '2025-12', total_spend: 74.97, count: 4 },
    { month: '2026-01', total_spend: 74.97, count: 4 },
    { month: '2026-02', total_spend: 89.97, count: 5 },
    { month: '2026-03', total_spend: 89.97, count: 5 },
    { month: '2026-04', total_spend: 89.97, count: 5 },
    { month: '2026-05', total_spend: 89.97, count: 5 },
  ],
  category_breakdown: [
    { category: 'Entertainment', total_spend: 45.98, percentage: 51.1, count: 3 },
    { category: 'Productivity', total_spend: 43.99, percentage: 48.9, count: 2 },
  ],
  active_subscriptions: 5,
};

const mockForecast = {
  forecast: [
    { month: '2026-05', total_spend: 89.97, count: 5 },
    { month: '2026-06', total_spend: 89.97, count: 5 },
    { month: '2026-07', total_spend: 89.97, count: 5 },
    { month: '2026-08', total_spend: 89.97, count: 5 },
    { month: '2026-09', total_spend: 89.97, count: 5 },
    { month: '2026-10', total_spend: 89.97, count: 5 },
  ],
  avg_projected_monthly_spend: 89.97,
};

describe('GET /api/analytics/spending', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns spending data for authenticated user', async () => {
    (analyticsService.getSpending as jest.Mock).mockResolvedValue(mockSpending);

    const res = await request(app).get('/api/analytics/spending');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      current_month_spend: expect.any(Number),
      monthly_trend: expect.any(Array),
      category_breakdown: expect.any(Array),
      active_subscriptions: expect.any(Number),
    });
    expect(analyticsService.getSpending).toHaveBeenCalledWith('test-user-id');
  });

  it('monthly_trend contains YYYY-MM formatted months', async () => {
    (analyticsService.getSpending as jest.Mock).mockResolvedValue(mockSpending);

    const res = await request(app).get('/api/analytics/spending');

    expect(res.status).toBe(200);
    const trend: Array<{ month: string }> = res.body.data.monthly_trend;
    trend.forEach(entry => {
      expect(entry.month).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  it('returns 500 when service throws', async () => {
    (analyticsService.getSpending as jest.Mock).mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/api/analytics/spending');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when not authenticated', async () => {
    (authenticate as jest.Mock).mockImplementationOnce((_req: any, res: any) => {
      res.status(401).json({ success: false, error: 'Unauthorized' });
    });

    const res = await request(app).get('/api/analytics/spending');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/analytics/forecast', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns forecast data for authenticated user', async () => {
    (analyticsService.getForecast as jest.Mock).mockResolvedValue(mockForecast);

    const res = await request(app).get('/api/analytics/forecast');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      forecast: expect.any(Array),
      avg_projected_monthly_spend: expect.any(Number),
    });
    expect(analyticsService.getForecast).toHaveBeenCalledWith('test-user-id');
  });

  it('forecast contains exactly 6 months', async () => {
    (analyticsService.getForecast as jest.Mock).mockResolvedValue(mockForecast);

    const res = await request(app).get('/api/analytics/forecast');

    expect(res.status).toBe(200);
    expect(res.body.data.forecast).toHaveLength(6);
  });

  it('forecast months are YYYY-MM formatted', async () => {
    (analyticsService.getForecast as jest.Mock).mockResolvedValue(mockForecast);

    const res = await request(app).get('/api/analytics/forecast');

    const forecast: Array<{ month: string }> = res.body.data.forecast;
    forecast.forEach(entry => {
      expect(entry.month).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  it('avg_projected_monthly_spend is numeric', async () => {
    (analyticsService.getForecast as jest.Mock).mockResolvedValue(mockForecast);

    const res = await request(app).get('/api/analytics/forecast');

    expect(typeof res.body.data.avg_projected_monthly_spend).toBe('number');
  });

  it('returns 500 when service throws', async () => {
    (analyticsService.getForecast as jest.Mock).mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/api/analytics/forecast');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when not authenticated', async () => {
    (authenticate as jest.Mock).mockImplementationOnce((_req: any, res: any) => {
      res.status(401).json({ success: false, error: 'Unauthorized' });
    });

    const res = await request(app).get('/api/analytics/forecast');
    expect(res.status).toBe(401);
  });
});
