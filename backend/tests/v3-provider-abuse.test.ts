import express from 'express';
import request from 'supertest';
import { resolveTxt } from 'node:dns/promises';
import v3GatewayRouter from '../src/routes/v3-gateway';
import { InMemoryProviderStore } from '../src/v3/provider-store';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
  resolveTxt: jest.fn().mockResolvedValue([]),
}));

describe('v3 provider abuse controls', () => {
  function buildApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/v3', v3GatewayRouter);
    return app;
  }

  function registrationBody(suffix: string) {
    return {
      identity: `provider-${suffix}`,
      payoutAddress: 'GTESTPAYOUTADDRESS',
      upstreamBaseUrl: `https://provider-${suffix}.example`,
      agreementTerms: 'tos:v1',
      mode: 'staging',
    };
  }

  function uniqueSourceIp() {
    return `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  }

  it('rate limits provider registration by source IP', async () => {
    const app = buildApp();
    const ip = uniqueSourceIp();

    for (let i = 0; i < 20; i += 1) {
      await request(app)
        .post('/api/v3/providers')
        .set('x-forwarded-for', ip)
        .send(registrationBody(`rate-${ip}-${i}`))
        .expect(201);
    }

    await request(app)
      .post('/api/v3/providers')
      .set('x-forwarded-for', ip)
      .send(registrationBody(`rate-${ip}-blocked`))
      .expect(429);
  });

  it('requires domain verification and review before directory listing, and supports reports and takedown', async () => {
    const app = buildApp();
    const registered = await request(app)
      .post('/api/v3/providers')
      .set('x-forwarded-for', uniqueSourceIp())
      .send(registrationBody(`review-${Date.now()}`))
      .expect(201);
    const { providerId, providerSecret, upstreamBaseUrl } = registered.body.data;
    const adminKey = process.env.ADMIN_API_KEY ?? 'test-admin-key-for-jest';

    await request(app).get('/api/v3/providers/review-queue').expect(401);

    const initialDirectory = await request(app).get('/api/v3/providers/directory').expect(200);
    expect(initialDirectory.body.data.some((provider: { providerId: string }) => provider.providerId === providerId)).toBe(false);

    await request(app)
      .patch(`/api/v3/providers/${providerId}/review`)
      .set('x-admin-api-key', adminKey)
      .send({ decision: 'approve', reason: 'checked provider details' })
      .expect(409);

    const pendingQueue = await request(app)
      .get('/api/v3/providers/review-queue')
      .set('x-admin-api-key', adminKey)
      .expect(200);
    const pendingProvider = pendingQueue.body.data.providers.find(
      (provider: { providerId: string }) => provider.providerId === providerId,
    );
    expect(pendingProvider).toMatchObject({ domainVerifiedAt: null });
    expect(pendingProvider).not.toHaveProperty('providerSecret');

    const challenge = await request(app)
      .post(`/api/v3/providers/${providerId}/domain-challenge`)
      .set('x-provider-key', providerSecret)
      .expect(200);
    expect(challenge.body.data.recordName).toBe(`_syncro-provider.${new URL(upstreamBaseUrl).hostname}`);

    (resolveTxt as jest.Mock).mockResolvedValueOnce([['syncro-provider-verification=incorrect']]);
    await request(app)
      .post(`/api/v3/providers/${providerId}/domain-verify`)
      .set('x-provider-key', providerSecret)
      .expect(400);

    (resolveTxt as jest.Mock).mockResolvedValueOnce([[challenge.body.data.recordValue]]);
    await request(app)
      .post(`/api/v3/providers/${providerId}/domain-verify`)
      .set('x-provider-key', providerSecret)
      .expect(200);

    const verifiedButUnreviewedDirectory = await request(app)
      .get('/api/v3/providers/directory')
      .expect(200);
    expect(
      verifiedButUnreviewedDirectory.body.data.some(
        (provider: { providerId: string }) => provider.providerId === providerId,
      ),
    ).toBe(false);

    await request(app)
      .patch(`/api/v3/providers/${providerId}/review`)
      .set('x-admin-api-key', adminKey)
      .send({ decision: 'approve', reason: 'domain verified and reviewed' })
      .expect(200);

    const listedDirectory = await request(app).get('/api/v3/providers/directory').expect(200);
    const listing = listedDirectory.body.data.find(
      (provider: { providerId: string }) => provider.providerId === providerId,
    );
    expect(listing).toMatchObject({
      providerId,
      identity: registered.body.data.identity,
      domain: new URL(upstreamBaseUrl).hostname,
    });
    expect(listing).not.toHaveProperty('providerSecret');

    const report = await request(app)
      .post(`/api/v3/providers/${providerId}/reports`)
      .send({ category: 'phishing', details: 'Provider page imitates another API.' })
      .expect(201);
    const queue = await request(app)
      .get('/api/v3/providers/review-queue')
      .set('x-admin-api-key', adminKey)
      .expect(200);
    expect(queue.body.data.reports).toContainEqual(
      expect.objectContaining({ reportId: report.body.data.reportId, status: 'open' }),
    );

    await request(app)
      .post(`/api/v3/providers/${providerId}/takedown`)
      .set('x-admin-api-key', adminKey)
      .send({ reason: 'confirmed provider impersonation' })
      .expect(200);

    const takenDownDirectory = await request(app).get('/api/v3/providers/directory').expect(200);
    expect(
      takenDownDirectory.body.data.some(
        (provider: { providerId: string }) => provider.providerId === providerId,
      ),
    ).toBe(false);

    await request(app)
      .post(`/api/v3/providers/reports/${report.body.data.reportId}/resolve`)
      .set('x-admin-api-key', adminKey)
      .send({ status: 'resolved', resolution: 'Provider was removed from the directory.' })
      .expect(200);
  });

  it('stops routing requests after a provider is taken down', () => {
    const store = new InMemoryProviderStore();
    const provider = store.registerProvider({
      identity: 'provider-takedown',
      payoutAddress: 'GTESTPAYOUTADDRESS',
      upstreamBaseUrl: 'https://provider-takedown.example',
      agreementTerms: 'tos:v1',
      mode: 'staging',
    });
    const route = store.registerRoute({
      providerId: provider.providerId,
      pathPattern: '/echo/*',
      method: 'POST',
      unit: 'call',
      priceStroops: 1,
      quantityExtractor: 'constant:1',
    });

    expect(store.findRoute(provider.providerId, 'POST', '/echo/task')).toEqual(route);
    store.takeDownProvider(provider.providerId, 'confirmed abuse');
    expect(store.findRoute(provider.providerId, 'POST', '/echo/task')).toBeNull();
  });
});
