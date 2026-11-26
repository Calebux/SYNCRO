import express from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import v3GatewayRouter from '../src/routes/v3-gateway';
import { InMemoryProviderStore } from '../src/v3/provider-store';
import { calculateChargeStroops } from '../src/v3/pricing';

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
    const providerSecret = registerRes.body.data.providerSecret as string;

    const challengeRes = await request(app)
      .post(`/api/v3/providers/${providerId}/payout-challenge`)
      .send({});
    const challenge = challengeRes.body.data.challenge as string;
    const signature = Buffer.from(kp.sign(Buffer.from(challenge))).toString('base64');
    await request(app)
      .post(`/api/v3/providers/${providerId}/payout-verify`)
      .send({ signature })
      .expect(200);

    return { providerId, providerSecret, keypair: kp };
  }

  it('keeps an earlier rate-card version after a price change', async () => {
    const app = buildApp();
    const { providerId, providerSecret } = await onboardProvider(app);

    const created = await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .set('x-provider-key', providerSecret)
      .send({
        pathPattern: '/echo/task',
        method: 'POST',
        unit: 'call',
        priceStroops: 2,
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
      })
      .expect(200);

    const revised = await request(app)
      .patch(`/api/v3/providers/${providerId}/routes/${routeId}`)
      .set('x-provider-key', providerSecret)
      .send({ priceStroops: 9 })
      .expect(200);

    expect(revised.body.data.version.label).toBe('v2');
    expect(revised.body.data.version.priceStroops).toBe(9);
    expect(revised.body.data.route.priceStroops).toBe(9);

    const cards = await request(app)
      .get(`/api/v3/providers/${providerId}/rate-cards`)
      .set('x-provider-key', providerSecret)
      .expect(200);
    const v1 = cards.body.data.find((version: { label: string }) => version.label === 'v1');
    const v2 = cards.body.data.find((version: { label: string }) => version.label === 'v2');
    expect(v1.priceStroops).toBe(2);
    expect(v2.priceStroops).toBe(9);
    expect(Date.parse(v1.effectiveFrom)).toBeLessThan(Date.parse(v2.effectiveFrom));

    const settlements = await request(app)
      .get(`/api/v3/providers/${providerId}/settlements`)
      .set('x-provider-key', providerSecret)
      .expect(200);
    expect(settlements.body.data).toHaveLength(1);
    expect(settlements.body.data[0]).toMatchObject({
      status: 'unsettled',
      amount: 2,
      price: 2,
      rateCardVersion: 'v1',
      rateCardEffectiveFrom: v1.effectiveFrom,
    });

    const revenue = await request(app)
      .get(`/api/v3/providers/${providerId}/revenue`)
      .set('x-provider-key', providerSecret)
      .expect(200);
    expect(revenue.body.data).toEqual({ settled: 0, unsettled: 2, inDispute: 0 });
    expect(revenue.body.data).not.toHaveProperty('total');
  });

  it('simulates draft tier pricing against historical settlements using gateway math', async () => {
    const app = buildApp();
    const { providerId, providerSecret } = await onboardProvider(app);
    const created = await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .set('x-provider-key', providerSecret)
      .send({
        pathPattern: '/free/echo',
        method: 'POST',
        unit: 'call',
        priceStroops: 5,
        freeUnits: 1,
        tiers: [
          { upToUnits: 10, priceStroops: 5 },
          { upToUnits: null, priceStroops: 2 },
        ],
        quantityExtractor: 'constant:1',
      })
      .expect(201);

    await request(app).post('/api/v3/registry/grants').send({
      agentId: 'pricing-agent',
      scopes: ['POST:/free/echo'],
    }).expect(201);
    await request(app).post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', 'pricing-agent')
      .send({ providerId, path: '/free/echo', channelId: 'pricing-channel', stateNonce: 1 })
      .expect(200);

    await request(app).post('/api/v3/registry/grants').send({
      agentId: 'pricing-agent-two',
      scopes: ['POST:/free/echo'],
    }).expect(201);
    // A second agent shares the same payment channel; historical simulation
    // must attribute this call to the authenticated agent, not the channel.
    await request(app).post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', 'pricing-agent-two')
      .send({ providerId, path: '/free/echo', channelId: 'pricing-channel', stateNonce: 2 })
      .expect(200);

    const simulation = await request(app)
      .post(`/api/v3/providers/${providerId}/pricing-simulator`)
      .set('x-provider-key', providerSecret)
      .send({
        routeId: created.body.data.routeId,
        source: 'historical',
        priceStroops: 3,
        freeUnits: 0,
        tiers: [{ upToUnits: null, priceStroops: 3 }],
        platformFeeBps: 250,
      })
      .expect(200);

    expect(simulation.body.data.totals).toMatchObject({
      calls: 2,
      draftGrossStroops: 6,
      draftPlatformFeeStroops: 0,
      draftProviderNetStroops: 6,
      currentGrossStroops: 0,
      differenceStroops: 6,
    });
    expect(simulation.body.data.rows.map((row: { agentId: string }) => row.agentId).sort()).toEqual([
      'pricing-agent',
      'pricing-agent-two',
    ]);
    expect(simulation.body.data.feeIsEstimate).toBe(true);
  });

  it('requires payout verification again after the address changes', async () => {
    const app = buildApp();
    const { providerId, providerSecret } = await onboardProvider(app);
    const next = Keypair.random();

    const updated = await request(app)
      .patch(`/api/v3/providers/${providerId}/payout-address`)
      .set('x-provider-key', providerSecret)
      .send({ payoutAddress: next.publicKey() })
      .expect(200);
    expect(updated.body.data.payoutVerified).toBe(false);

    await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .set('x-provider-key', providerSecret)
      .send({
        pathPattern: '/echo/*',
        method: 'POST',
        unit: 'call',
        priceStroops: 1,
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
      unit: 'call',
      priceStroops: 2,
      quantityExtractor: 'constant:1',
    });
    const first = store.applicableVersion(route.routeId, route.createdAt);
    expect(first?.label).toBe('v1');
    expect(first?.priceStroops).toBe(2);

    const second = store.reviseRoute(provider.providerId, route.routeId, { priceStroops: 9 }).version;
    const beforeChange = new Date(Date.parse(second.effectiveFrom) - 1).toISOString();
    expect(store.applicableVersion(route.routeId, beforeChange)?.priceStroops).toBe(2);
    expect(store.applicableVersion(route.routeId, second.effectiveFrom)?.priceStroops).toBe(9);
    expect(store.listRateCards(provider.providerId).find((version) => version.label === 'v1')?.priceStroops).toBe(2);
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
      unit: 'call',
      quantity: 1,
      priceStroops: 1,
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

  it('keeps tier schedules immutable across rate-card revisions', () => {
    const store = new InMemoryProviderStore();
    const provider = store.registerProvider({
      identity: 'tiered-provider',
      payoutAddress: 'GADDRESS',
      upstreamBaseUrl: 'https://provider.example',
      agreementTerms: 'tos:v1',
      mode: 'staging',
    });
    const firstSchedule = {
      freeUnits: 10,
      tiers: [
        { upToUnits: 100, priceStroops: 5 },
        { upToUnits: null, priceStroops: 2 },
      ],
    };
    const route = store.registerRoute({
      providerId: provider.providerId,
      pathPattern: '/tiered/*',
      method: 'POST',
      unit: 'token',
      priceStroops: 5,
      quantityExtractor: 'constant:1',
      ...firstSchedule,
    });
    const first = store.applicableVersion(route.routeId, route.createdAt);
    expect(first).toMatchObject(firstSchedule);

    const secondSchedule = {
      freeUnits: 20,
      tiers: [
        { upToUnits: 200, priceStroops: 4 },
        { upToUnits: null, priceStroops: 1 },
      ],
    };
    const second = store.reviseRoute(provider.providerId, route.routeId, {
      ...secondSchedule,
      priceStroops: 4,
    }).version;
    expect(second).toMatchObject(secondSchedule);
    expect(store.listRateCards(provider.providerId).find((version) => version.versionId === first?.versionId)).toMatchObject(firstSchedule);
  });

});


describe('gateway tiered pricing', () => {
  it('preserves flat pricing when no schedule is supplied', () => {
    expect(calculateChargeStroops(7, 3)).toBe(21);
  });

  it('deducts the per-call free allowance before charging', () => {
    expect(calculateChargeStroops(7, 5, { freeUnits: 2 })).toBe(21);
    expect(calculateChargeStroops(7, 2, { freeUnits: 2 })).toBe(0);
  });

  it('applies marginal tiers after the free allowance', () => {
    const schedule = {
      freeUnits: 2,
      tiers: [
        { upToUnits: 3, priceStroops: 10 },
        { upToUnits: 8, priceStroops: 6 },
        { upToUnits: null, priceStroops: 2 },
      ],
    };
    // 10 units: 2 free, then 3 @ 10, 5 @ 6.
    expect(calculateChargeStroops(10, 10, schedule)).toBe(60);
  });

  it('rejects malformed tier schedules instead of silently mispricing', () => {
    expect(() => calculateChargeStroops(10, 5, {
      tiers: [
        { upToUnits: 5, priceStroops: 10 },
        { upToUnits: 4, priceStroops: 5 },
        { upToUnits: null, priceStroops: 1 },
      ],
    })).toThrow(/strictly increasing/);
    expect(() => calculateChargeStroops(10, 5, {
      tiers: [{ upToUnits: 5, priceStroops: 10 }],
    })).toThrow(/unlimited upper bound/);
  });

  it('rejects charges that exceed safe integer precision', () => {
    expect(() => calculateChargeStroops(Number.MAX_SAFE_INTEGER, 2)).toThrow(/maximum safe integer/);
  });
});
