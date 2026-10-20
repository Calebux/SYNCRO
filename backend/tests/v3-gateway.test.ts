import express from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import v3GatewayRouter from '../src/routes/v3-gateway';
import { decodeReceiptHeader, verifyReceipt } from '../../sdk/src/receipts';

describe('v3 gateway routes', () => {
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

  async function onboardProvider(app: express.Express, mode: 'staging' | 'production' = 'staging') {
    const kp = Keypair.random();
    const registerRes = await request(app).post('/api/v3/providers').send({
      identity: 'provider-a',
      payoutAddress: kp.publicKey(),
      upstreamBaseUrl: 'https://provider.example',
      agreementTerms: 'tos:v1',
      mode,
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

    return { providerId, providerSecret };
  }

  it('rejects out-of-scope before upstream call', async () => {
    const app = buildApp();
    const { providerId } = await onboardProvider(app);
    await request(app).post(`/api/v3/providers/${providerId}/routes`).send({
      pathPattern: '/echo/*',
      method: 'POST',
      unit: 'request',
      price: 2,
      quantityExtractor: 'constant:1',
    }).expect(201);

    await request(app).post('/api/v3/registry/grants').send({
      agentId: 'agent-a',
      scopes: ['POST:/different/*'],
    }).expect(201);

    const res = await request(app)
      .post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', 'agent-a')
      .send({
        providerId,
        path: '/echo/task',
        channelId: 'channel-1',
        stateNonce: 7,
        rateCardVersion: 'rc-v1',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('missing_scope');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('returns signed receipt headers and retrievable full record', async () => {
    const app = buildApp();
    const { providerId } = await onboardProvider(app);
    await request(app).post(`/api/v3/providers/${providerId}/routes`).send({
      pathPattern: '/echo/*',
      method: 'POST',
      unit: 'request',
      price: 3,
      quantityExtractor: 'constant:1',
    }).expect(201);

    await request(app).post('/api/v3/registry/grants').send({
      agentId: 'agent-a',
      scopes: ['POST:/echo/*'],
    }).expect(201);

    const paid = await request(app)
      .post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', 'agent-a')
      .send({
        providerId,
        path: '/echo/task',
        channelId: 'channel-2',
        stateNonce: 8,
        rateCardVersion: 'rc-v2',
      })
      .expect(200);

    const compact = paid.header['x-syncro-receipt'] as string;
    const receiptUrl = paid.header['x-syncro-receipt-url'] as string;
    expect(compact).toBeTruthy();
    expect(receiptUrl).toContain('/api/v3/receipts/');

    const parsed = decodeReceiptHeader(compact);
    expect(verifyReceipt(parsed)).toBe(true);

    const full = await request(app).get(receiptUrl).expect(200);
    expect(verifyReceipt(full.body.data)).toBe(true);
    expect(full.body.data).not.toHaveProperty('requestBody');
    expect(full.body.data).not.toHaveProperty('responseBody');
  });

  // ── Provider auth tests ──────────────────────────────────

  describe('provider authentication', () => {
    it('returns 401 for mutating routes without x-provider-key', async () => {
      const app = buildApp();
      const { providerId } = await onboardProvider(app);

      // PATCH payout-address without provider key
      await request(app)
        .patch(`/api/v3/providers/${providerId}/payout-address`)
        .send({ payoutAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' })
        .expect(401);

      // PATCH degraded-mode-policy without provider key
      await request(app)
        .patch(`/api/v3/providers/${providerId}/degraded-mode-policy`)
        .send({ failMode: 'fail_closed' })
        .expect(401);

      // PATCH rate-limit without provider key
      await request(app)
        .patch(`/api/v3/providers/${providerId}/rate-limit`)
        .send({ requestsPerInterval: 10 })
        .expect(401);

      // POST routes without provider key
      await request(app)
        .post(`/api/v3/providers/${providerId}/routes`)
        .send({ pathPattern: '/echo/*', method: 'POST', unit: 'request', price: 1 })
        .expect(401);

      // PATCH routes without provider key
      await request(app)
        .patch(`/api/v3/providers/${providerId}/routes/some-route`)
        .send({ price: 2 })
        .expect(401);

      // GET routes without provider key
      await request(app)
        .get(`/api/v3/providers/${providerId}/routes`)
        .expect(401);

      // GET rate-cards without provider key
      await request(app)
        .get(`/api/v3/providers/${providerId}/rate-cards`)
        .expect(401);

      // GET settlements without provider key
      await request(app)
        .get(`/api/v3/providers/${providerId}/settlements`)
        .expect(401);

      // GET revenue without provider key
      await request(app)
        .get(`/api/v3/providers/${providerId}/revenue`)
        .expect(401);

      // POST dry-run without provider key
      await request(app)
        .post(`/api/v3/providers/${providerId}/routes/dry-run`)
        .send({ method: 'POST', path: '/echo/task' })
        .expect(401);
    });

    it('returns 403 when a different provider tries to access another provider resources', async () => {
      const app = buildApp();
      const { providerId: providerAId, providerSecret: providerASecret } = await onboardProvider(app, 'staging');
      const { providerId: providerBId, providerSecret: providerBSecret } = await onboardProvider(app, 'staging');

      // Provider B tries to access Provider A's routes
      await request(app)
        .get(`/api/v3/providers/${providerAId}/routes`)
        .set('x-provider-key', providerBSecret)
        .expect(403);

      // Provider B tries to mutate Provider A's payout address
      await request(app)
        .patch(`/api/v3/providers/${providerAId}/payout-address`)
        .set('x-provider-key', providerBSecret)
        .send({ payoutAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' })
        .expect(403);

      // Provider B tries to access Provider A's revenue
      await request(app)
        .get(`/api/v3/providers/${providerAId}/revenue`)
        .set('x-provider-key', providerBSecret)
        .expect(403);

      // Provider B tries to access Provider A's settlements
      await request(app)
        .get(`/api/v3/providers/${providerAId}/settlements`)
        .set('x-provider-key', providerBSecret)
        .expect(403);

      // Provider B tries to access Provider A's rate-cards
      await request(app)
        .get(`/api/v3/providers/${providerAId}/rate-cards`)
        .set('x-provider-key', providerBSecret)
        .expect(403);
    });

    it('allows the owning provider to access its own resources', async () => {
      const app = buildApp();
      const { providerId, providerSecret } = await onboardProvider(app);

      // Register a route first
      await request(app)
        .post(`/api/v3/providers/${providerId}/routes`)
        .set('x-provider-key', providerSecret)
        .send({ pathPattern: '/echo/*', method: 'POST', unit: 'request', price: 1 })
        .expect(201);

      // GET routes as the owning provider
      await request(app)
        .get(`/api/v3/providers/${providerId}/routes`)
        .set('x-provider-key', providerSecret)
        .expect(200);

      // GET revenue as the owning provider
      await request(app)
        .get(`/api/v3/providers/${providerId}/revenue`)
        .set('x-provider-key', providerSecret)
        .expect(200);

      // GET settlements as the owning provider
      await request(app)
        .get(`/api/v3/providers/${providerId}/settlements`)
        .set('x-provider-key', providerSecret)
        .expect(200);

      // PATCH payout-address as the owning provider
      await request(app)
        .patch(`/api/v3/providers/${providerId}/payout-address`)
        .set('x-provider-key', providerSecret)
        .send({ payoutAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' })
        .expect(200);
    });

    it('keeps GET /receipts/:receiptId public', async () => {
      const app = buildApp();
      const { providerId, providerSecret } = await onboardProvider(app);

      await request(app)
        .post(`/api/v3/providers/${providerId}/routes`)
        .set('x-provider-key', providerSecret)
        .send({ pathPattern: '/echo/*', method: 'POST', unit: 'request', price: 1 })
        .expect(201);

      // Receipt lookup should work without provider key
      await request(app)
        .get('/api/v3/receipts/nonexistent')
        .expect(404);
    });

    it('keeps POST /providers/:providerId/payout-challenge public', async () => {
      const app = buildApp();
      const { providerId } = await onboardProvider(app);

      // Challenge endpoint should work without provider key
      const res = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-challenge`)
        .send({})
        .expect(200);

      expect(res.body.data).toHaveProperty('challenge');
      expect(res.body.data).toHaveProperty('expiresAt');
    });
  });
});

