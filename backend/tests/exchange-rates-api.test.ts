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

function getRouteHandler(mockService: ExchangeRateService) {
  const router = createExchangeRatesRouter(mockService) as any;
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === '/' && entry.route?.methods?.get,
  );

  if (!layer) {
    throw new Error('GET / route handler not found');
  }

  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>;
}

describe('GET /api/exchange-rates', () => {
  let handler: ReturnType<typeof getRouteHandler>;
  let mockService: ExchangeRateService;

  beforeEach(() => {
    mockService = {
      getExchangeRateResponse: jest.fn().mockResolvedValue({
        base: 'USD',
        rates: { EUR: 0.92, GBP: 0.79 },
        cachedAt: '2026-03-28T12:00:00Z',
        ageMs: 1234,
        stale: false,
        source: 'live',
      }),
    } as unknown as ExchangeRateService;

    handler = getRouteHandler(mockService);
  });

  it('returns rates for the given base currency', async () => {
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await handler({ query: { base: 'USD' } }, res, jest.fn());

    expect(mockService.getExchangeRateResponse).toHaveBeenCalledWith('USD');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        base: 'USD',
        rates: { EUR: 0.92, GBP: 0.79 },
        cachedAt: '2026-03-28T12:00:00Z',
        ageMs: 1234,
        stale: false,
        source: 'live',
      },
      meta: {
        timestamp: expect.any(String),
        stale: false,
        source: 'live',
        ageMs: 1234,
      },
    });
  });

  it('defaults to USD when no base provided', async () => {
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await handler({ query: {} }, res, jest.fn());

    expect(mockService.getExchangeRateResponse).toHaveBeenCalledWith('USD');
    expect(res.json).toHaveBeenCalled();
  });

  it('rejects unsupported base currency', async () => {
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await expect(handler({ query: { base: 'FAKE' } }, res, jest.fn())).rejects.toThrow(
      'Unsupported currency: FAKE',
    );
  });
});
