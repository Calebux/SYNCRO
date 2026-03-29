jest.mock('../src/config/database', () => ({
  supabase: { auth: { getUser: jest.fn() } },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import { ExchangeRateService } from '../src/services/exchange-rate/exchange-rate-service';
import { createExchangeRatesRouter } from '../src/routes/exchange-rates';
import express from 'express';
import request from 'supertest';

describe('GET /api/exchange-rates', () => {
  let app: express.Application;

  beforeEach(() => {
    const mockService = {
      getExchangeRateResponse: jest.fn().mockResolvedValue({
        base: 'USD',
        rates: { EUR: 0.92, GBP: 0.79 },
        cachedAt: '2026-03-28T12:00:00Z',
        stale: false,
      }),
    } as unknown as ExchangeRateService;

    app = express();
    // Simulate auth by injecting user
    app.use((req: any, _res, next) => {
      req.user = { id: 'test-user', email: 'test@test.com' };
      next();
    });
    app.use('/api/exchange-rates', createExchangeRatesRouter(mockService));
  });

  it('returns rates for the given base currency', async () => {
    const res = await request(app).get('/api/exchange-rates?base=USD');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.base).toBe('USD');
    expect(res.body.data.rates.EUR).toBe(0.92);
    expect(res.body.data.stale).toBe(false);
  });

  it('defaults to USD when no base provided', async () => {
    const res = await request(app).get('/api/exchange-rates');

    expect(res.status).toBe(200);
    expect(res.body.data.base).toBe('USD');
  });

  it('rejects unsupported base currency', async () => {
    const res = await request(app).get('/api/exchange-rates?base=FAKE');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
