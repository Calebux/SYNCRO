import express from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import v3GatewayRouter from '../src/routes/v3-gateway';
import { InMemoryProviderStore } from '../src/v3/provider-store';

describe('provider console reads', () => {
  beforeEach(() => {
    process.env.ENABLE_TESTNET_ACTIONS = 'true';
    process.env.STELLAR_NETWORK = 'testnet';
    (global as any).fetch = jest.fn().mockResolvedValue({
      status: 200,
      async json() {
        return { ok: true };
      },
      async text() {
        return '{"ok":true}';
      },
    });
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v3', v3GatewayRouter);
    return app;
  }

  async function onboardProvider(app: express.Express) {
    const kp = Keypair.random();
    const registerRes = await request(app).post('/api/v3/providers').send({
      identity: 'provider-console',
      payoutAddress: kp.publicKey(),
      upstreamBaseUrl: 'https://provider.example',
      agreementTerms: 'tos:v1',
      mode: 'staging',
    });
    const providerId = registerRes.body.data.providerId as string;

    const challengeRes = await request(app)
      .post(`/api/v3/providers/${providerId}/payout-challenge`)
      .send({});
    const challenge = challengeRes.body.data.challenge as string;
    const signature = Buffer.from(kp.sign(Buffer.from(challenge))).toString('base64');
    await request(app)
      .post(`/api/v3/providers/${providerId}/payout-verify`)
      .send({ signature })
      .expect(200);

    return { providerId, keypair: kp };
  }

  it('keeps an earlier rate-card version after a price change', async () => {
    const app = buildApp();
    const { providerId } = await onboardProvider(app);

    const created = await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .send({
        pathPattern: '/echo/task',
        method: 'POST',
        unit: 'request',
        price: 2,
        quantityExtractor: 'constant:1',
      })
      .expect(201);
    const routeId = created.body.data.routeId as string;

    await request(app).post('/api/v3/registry/grants').send({
      agentId: 'agent-console',
      scopes: ['POST:/echo/task'],
    }).expect(201);

    await request(app)
      .post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', 'agent-console')
      .send({
        providerId,
        path: '/echo/task',
        channelId: 'channel-console',
        stateNonce: 1,
        rateCardVersion: 'caller-supplied',
      })
      .expect(200);

    const revised = await request(app)
      .patch(`/api/v3/providers/${providerId}/routes/${routeId}`)
      .send({ price: 9 })
      .expect(200);

    expect(revised.body.data.version.label).toBe('v2');
    expect(revised.body.data.version.price).toBe(9);
    expect(revised.body.data.route.price).toBe(9);

    const cards = await request(app).get(`/api/v3/providers/${providerId}/rate-cards`).expect(200);
    const v1 = cards.body.data.find((version: { label: string }) => version.label === 'v1');
    const v2 = cards.body.data.find((version: { label: string }) => version.label === 'v2');
    expect(v1.price).toBe(2);
    expect(v2.price).toBe(9);
    expect(Date.parse(v1.effectiveFrom)).toBeLessThan(Date.parse(v2.effectiveFrom));

    const settlements = await request(app)
      .get(`/api/v3/providers/${providerId}/settlements`)
      .expect(200);
    expect(settlements.body.data).toHaveLength(1);
    expect(settlements.body.data[0]).toMatchObject({
      status: 'unsettled',
      amount: 2,
      price: 2,
      rateCardVersion: 'v1',
      rateCardEffectiveFrom: v1.effectiveFrom,
    });

    const revenue = await request(app).get(`/api/v3/providers/${providerId}/revenue`).expect(200);
    expect(revenue.body.data).toEqual({ settled: 0, unsettled: 2, inDispute: 0 });
    expect(revenue.body.data).not.toHaveProperty('total');
  });

  it('requires payout verification again after the address changes', async () => {
    const app = buildApp();
    const { providerId } = await onboardProvider(app);
    const next = Keypair.random();

    const updated = await request(app)
      .patch(`/api/v3/providers/${providerId}/payout-address`)
      .send({ payoutAddress: next.publicKey() })
      .expect(200);
    expect(updated.body.data.payoutVerified).toBe(false);

    await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .send({
        pathPattern: '/echo/*',
        method: 'POST',
        unit: 'request',
        price: 1,
        quantityExtractor: 'constant:1',
      })
      .expect(400);

    const challengeRes = await request(app)
      .post(`/api/v3/providers/${providerId}/payout-challenge`)
      .send({});
    const challenge = challengeRes.body.data.challenge as string;
    const signature = Buffer.from(next.sign(Buffer.from(challenge))).toString('base64');
    const verified = await request(app)
      .post(`/api/v3/providers/${providerId}/payout-verify`)
      .send({ signature })
      .expect(200);
    expect(verified.body.data.payoutVerified).toBe(true);
  });
});

describe('rate card applicability', () => {
  it('prices a call with the version in force at meter time', () => {
    const store = new InMemoryProviderStore();
    const provider = store.registerProvider({
      identity: 'provider-a',
      payoutAddress: 'GADDRESS',
      upstreamBaseUrl: 'https://provider.example',
      agreementTerms: 'tos:v1',
      mode: 'staging',
    });
    const route = store.registerRoute({
      providerId: provider.providerId,
      pathPattern: '/echo/*',
      method: 'POST',
      unit: 'request',
      price: 2,
      quantityExtractor: 'constant:1',
    });
    const first = store.applicableVersion(route.routeId, route.createdAt);
    expect(first?.label).toBe('v1');
    expect(first?.price).toBe(2);

    const second = store.reviseRoute(provider.providerId, route.routeId, { price: 9 }).version;
    const beforeChange = new Date(Date.parse(second.effectiveFrom) - 1).toISOString();
    expect(store.applicableVersion(route.routeId, beforeChange)?.price).toBe(2);
    expect(store.applicableVersion(route.routeId, second.effectiveFrom)?.price).toBe(9);
    expect(store.listRateCards(provider.providerId).find((version) => version.label === 'v1')?.price).toBe(2);
  });

  it('sums settled, unsettled, and in-dispute amounts in separate buckets', () => {
    const store = new InMemoryProviderStore();
    const provider = store.registerProvider({
      identity: 'provider-a',
      payoutAddress: 'GADDRESS',
      upstreamBaseUrl: 'https://provider.example',
      agreementTerms: 'tos:v1',
      mode: 'staging',
    });
    const base = {
      providerId: provider.providerId,
      routeId: 'route-1',
      receiptId: 'receipt',
      method: 'POST',
      pathPattern: '/echo/*',
      unit: 'request',
      quantity: 1,
      price: 1,
      rateCardVersion: 'v1',
      rateCardEffectiveFrom: '2026-01-01T00:00:00.000Z',
      meteredAt: '2026-01-02T00:00:00.000Z',
      channelId: 'channel-1',
    };
    store.recordSettlement({ ...base, receiptId: 'a', amount: 4, status: 'settled' });
    store.recordSettlement({ ...base, receiptId: 'b', amount: 5, status: 'unsettled' });
    store.recordSettlement({ ...base, receiptId: 'c', amount: 1, status: 'unsettled' });
    store.recordSettlement({ ...base, receiptId: 'd', amount: 6, status: 'in_dispute' });

    expect(store.revenue(provider.providerId)).toEqual({
      settled: 4,
      unsettled: 6,
      inDispute: 6,
    });
    expect(store.revenue(provider.providerId)).not.toHaveProperty('total');
  });
});
