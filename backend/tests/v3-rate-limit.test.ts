import express from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import v3GatewayRouter, { meter } from '../src/routes/v3-gateway';

describe('v3 per-agent rate limiting (Issue #1447)', () => {
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

  afterEach(() => {
    (global as any).fetch.mockClear();
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v3', v3GatewayRouter);
    return app;
  }

  async function onboardProvider(
    app: express.Express,
    rateLimit?: Record<string, number>,
  ) {
    const kp = Keypair.random();
    const registerRes = await request(app).post('/api/v3/providers').send({
      identity: `provider-${kp.publicKey().slice(-8)}`,
      payoutAddress: kp.publicKey(),
      upstreamBaseUrl: 'https://provider.example',
      agreementTerms: 'tos:v1',
      mode: 'staging',
      rateLimit,
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

    return { providerId };
  }

  async function registerRoute(app: express.Express, providerId: string, rateLimit?: Record<string, number>) {
    await request(app).post(`/api/v3/providers/${providerId}/routes`).send({
      pathPattern: '/echo/*',
      method: 'POST',
      unit: 'request',
      price: 2,
      quantityExtractor: 'constant:1',
      rateLimit,
    }).expect(201);
  }

  async function grant(app: express.Express, agentId: string, scope = 'POST:/echo/*') {
    await request(app).post('/api/v3/registry/grants').send({
      agentId,
      scopes: [scope],
    }).expect(201);
  }

  function paidCall(app: express.Express, providerId: string, agentId: string, stateNonce: number) {
    return request(app)
      .post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', agentId)
      .send({
        providerId,
        path: '/echo/task',
        channelId: `channel-${agentId}`,
        stateNonce,
        rateCardVersion: 'rc-v1',
      });
  }

  it('throttles a runaway agent at the per-route burst limit (429) before the cap is exhausted', async () => {
    const app = buildApp();
    const { providerId } = await onboardProvider(app, {
      requestsPerInterval: 1,
      intervalMs: 1_000,
      burstAllowance: 0,
    });
    await registerRoute(app, providerId);
    await grant(app, 'agent-a');
    meter.setLimit('agent-a', 1_000_000);

    const first = await paidCall(app, providerId, 'agent-a', 1);
    expect(first.status).toBe(200);

    const denied = await paidCall(app, providerId, 'agent-a', 2);
    expect(denied.status).toBe(429);
    expect(denied.body.error).toBe('GATEWAY_RATE_LIMITED');
    expect(denied.body.code).toBe('GATEWAY_RATE_LIMITED');
    expect(denied.body.action).toBe('wait');
    expect(denied.body.route).toBe('POST:/echo/*');
    expect(Number(denied.header['retry-after'])).toBeGreaterThanOrEqual(1);

    // The throttled call neither reached the upstream nor spent the cap.
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(meter.read('agent-a').used).toBe(1);
  });

  it('distinguishes slow-down (429) from out-of-funds (402)', async () => {
    const app = buildApp();
    const tight = await onboardProvider(app, {
      requestsPerInterval: 0,
      intervalMs: 60_000,
      burstAllowance: 0,
    });
    await registerRoute(app, tight.providerId);
    await grant(app, 'agent-slow');
    meter.setLimit('agent-slow', 1_000_000);

    const slowDown = await paidCall(app, tight.providerId, 'agent-slow', 1);
    expect(slowDown.status).toBe(429);
    expect(slowDown.body.error).toBe('GATEWAY_RATE_LIMITED');
    expect(slowDown.body.action).toBe('wait');
    expect((global as any).fetch).toHaveBeenCalledTimes(0);

    const broke = await onboardProvider(app);
    await registerRoute(app, broke.providerId);
    await grant(app, 'agent-broke');
    meter.setLimit('agent-broke', 0);

    const outOfFunds = await paidCall(app, broke.providerId, 'agent-broke', 1);
    expect(outOfFunds.status).toBe(402);
    expect(outOfFunds.body.error).toBe('GATEWAY_METER_INSUFFICIENT');
    expect(outOfFunds.body.action).toBe('fund');
    expect(outOfFunds.body.available).toBe(0);
    expect(outOfFunds.body.needed).toBe(1);
    expect((global as any).fetch).toHaveBeenCalledTimes(0);

    expect(outOfFunds.body.error).not.toBe(slowDown.body.error);
  });

  it('lifts a provider-wide throttle at runtime via PATCH /rate-limit', async () => {
    const app = buildApp();
    const { providerId } = await onboardProvider(app, {
      requestsPerInterval: 0,
      intervalMs: 60_000,
      burstAllowance: 0,
    });
    await registerRoute(app, providerId);
    await grant(app, 'agent-c');

    await paidCall(app, providerId, 'agent-c', 1).expect(429);

    const patch = await request(app)
      .patch(`/api/v3/providers/${providerId}/rate-limit`)
      .send({ requestsPerInterval: 5 })
      .expect(200);
    expect(patch.body.data).toMatchObject({
      requestsPerInterval: 5,
      intervalMs: 60_000,
      burstAllowance: 0,
    });

    await paidCall(app, providerId, 'agent-c', 2).expect(200);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it('lets a per-route override stand after the provider default is relaxed', async () => {
    const app = buildApp();
    const { providerId } = await onboardProvider(app, {
      requestsPerInterval: 0,
      intervalMs: 60_000,
      burstAllowance: 0,
    });
    // The route keeps its own deny-all override even when the provider
    // default is relaxed — a provider retune must not silently re-enable a
    // route whose operator throttled it explicitly (#1447).
    await registerRoute(app, providerId, {
      requestsPerInterval: 0,
      intervalMs: 60_000,
      burstAllowance: 0,
    });
    await grant(app, 'agent-d');

    await request(app)
      .patch(`/api/v3/providers/${providerId}/rate-limit`)
      .send({ requestsPerInterval: 100 })
      .expect(200);

    await paidCall(app, providerId, 'agent-d', 1).expect(429);
  });
});