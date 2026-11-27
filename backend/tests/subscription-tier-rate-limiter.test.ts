import request from 'supertest';
import express from 'express';
import { createSubscriptionTierLimiter } from '../src/middleware/subscription-tier-rate-limiter';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: { subscription_tier: 'free' }, error: null }),
        }),
      }),
    }),
  },
}));

function makeApp(opts: Parameters<typeof createSubscriptionTierLimiter>[0] = {}) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).user = { id: 'user-123', email: 'test@example.com', role: 'member' };
    next();
  });
  app.use(createSubscriptionTierLimiter(opts));
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('createSubscriptionTierLimiter', () => {
  it('sets X-RateLimit headers on successful requests', async () => {
    const res = await request(makeApp()).get('/test').expect(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('allows unauthenticated requests through without rate limiting', async () => {
    const app = express();
    app.use(createSubscriptionTierLimiter());
    app.get('/test', (_req, res) => res.json({ ok: true }));
    await request(app).get('/test').expect(200);
  });

  it('returns 429 with Retry-After when limit exceeded (free tier = 100)', async () => {
    const app = makeApp();
    const promises = Array.from({ length: 101 }, () => request(app).get('/test'));
    const responses = await Promise.all(promises);
    const limited = responses.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0].headers['retry-after']).toBeDefined();
    expect(limited[0].body.error).toBe('Too many requests');
  });

  it('applies a lower limit for sensitive endpoints', async () => {
    const app = makeApp({ sensitive: true });
    // Sensitive free tier = 10 req/min (100 * 0.1)
    const promises = Array.from({ length: 11 }, () => request(app).get('/test'));
    const responses = await Promise.all(promises);
    const limited = responses.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
  });
});
