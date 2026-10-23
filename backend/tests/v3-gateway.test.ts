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

    return { providerId, providerSecret, keypair: kp };
  }

  it('rejects out-of-scope before upstream call', async () => {
    const app = buildApp();
    const { providerId, providerSecret } = await onboardProvider(app);
    await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .set('x-provider-key', providerSecret)
      .send({
        pathPattern: '/echo/*',
        method: 'POST',
        unit: 'call',
        priceStroops: 2,
        quantityExtractor: 'constant:1',
      })
      .expect(201);

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
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GATEWAY_SCOPE_DENIED');
    expect(res.body.error).toBeUndefined();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('returns signed receipt headers and retrievable full record', async () => {
    const app = buildApp();
    const { providerId, providerSecret } = await onboardProvider(app);
    await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .set('x-provider-key', providerSecret)
      .send({
        pathPattern: '/echo/*',
        method: 'POST',
        unit: 'call',
        priceStroops: 3,
        quantityExtractor: 'constant:1',
      })
      .expect(201);

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

  it('bills a constant-one route independently of the client quantity', async () => {
    const app = buildApp();
    const { providerId, providerSecret } = await onboardProvider(app);
    await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .set('x-provider-key', providerSecret)
      .send({
        pathPattern: '/echo/*',
        method: 'POST',
        unit: 'call',
        priceStroops: 3,
        quantityExtractor: 'constant:1',
      })
      .expect(201);

    for (const [agentId, quantity] of [['agent-tiny', 0.0001], ['agent-huge', 1_000_000_000]] as const) {
      await request(app).post('/api/v3/registry/grants').send({
        agentId,
        scopes: ['POST:/echo/*'],
      }).expect(201);

      const paid = await request(app)
        .post('/api/v3/gateway/paid')
        .set('x-syncro-agent-id', agentId)
        .send({
          providerId,
          path: '/echo/task',
          quantity,
          channelId: `channel-${agentId}`,
          stateNonce: 1,
        })
        .expect(200);

      const receipt = decodeReceiptHeader(paid.header['x-syncro-receipt']);
      expect(receipt.quantity).toBe(1);
    }
  });

  // ── Issue #1617: paid-call failures map to gateway taxonomy codes ──────────

  it('maps an unregistered route to a 400 GATEWAY_BAD_REQUEST without leaking internals', async () => {
    const app = buildApp();
    const { providerId } = await onboardProvider(app);
    await request(app).post('/api/v3/registry/grants').send({
      agentId: 'agent-a',
      scopes: ['POST:/echo/*'],
    }).expect(201);

    const res = await request(app)
      .post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', 'agent-a')
      .send({
        providerId,
        path: '/echo/task',
        channelId: 'channel-1',
        stateNonce: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('GATEWAY_BAD_REQUEST');
    expect(res.body.error).toBeUndefined();
    expect(res.body.message).not.toMatch(/route not registered/i);
  });

  it('maps an unreachable upstream to a retryable 503 GATEWAY_UPSTREAM_UNAVAILABLE', async () => {
    const app = buildApp();
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:443'));
    const { providerId, providerSecret } = await onboardProvider(app);
    await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .set('x-provider-key', providerSecret)
      .send({
        pathPattern: '/echo/*',
        method: 'POST',
        unit: 'call',
        priceStroops: 2,
        quantityExtractor: 'constant:1',
      })
      .expect(201);
    await request(app).post('/api/v3/registry/grants').send({
      agentId: 'agent-a',
      scopes: ['POST:/echo/*'],
    }).expect(201);

    const res = await request(app)
      .post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', 'agent-a')
      .send({
        providerId,
        path: '/echo/task',
        channelId: 'channel-1',
        stateNonce: 1,
      });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('GATEWAY_UPSTREAM_UNAVAILABLE');
    expect(res.headers['retry-after']).toBe('5');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('maps an unknown provider to a 400 GATEWAY_BAD_REQUEST without leaking internals', async () => {
    const app = buildApp();
    await request(app).post('/api/v3/registry/grants').send({
      agentId: 'agent-a',
      scopes: ['POST:/echo/*'],
    }).expect(201);

    const res = await request(app)
      .post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', 'agent-a')
      .send({
        providerId: '00000000-0000-4000-8000-000000000000',
        path: '/echo/task',
        channelId: 'channel-1',
        stateNonce: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('GATEWAY_BAD_REQUEST');
    expect(res.body.error).toBeUndefined();
    expect(res.body.message).not.toMatch(/provider not found/i);
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
        .send({ pathPattern: '/echo/*', method: 'POST', unit: 'call', priceStroops: 1 })
        .expect(401);

      // PATCH routes without provider key
      await request(app)
        .patch(`/api/v3/providers/${providerId}/routes/some-route`)
        .send({ priceStroops: 2 })
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
        .send({ pathPattern: '/echo/*', method: 'POST', unit: 'call', priceStroops: 1 })
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

      // PATCH payout-address as the owning provider now requires a challengeId
      await request(app)
        .patch(`/api/v3/providers/${providerId}/payout-address`)
        .set('x-provider-key', providerSecret)
        .send({ payoutAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' })
        .expect(400);
    });

    it('keeps GET /receipts/:receiptId public', async () => {
      const app = buildApp();
      const { providerId, providerSecret } = await onboardProvider(app);

      await request(app)
        .post(`/api/v3/providers/${providerId}/routes`)
        .set('x-provider-key', providerSecret)
        .send({ pathPattern: '/echo/*', method: 'POST', unit: 'call', priceStroops: 1 })
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

  // ── Payout address change security (#1610) ────────────────

  describe('payout address change security', () => {
    it('rejects PATCH payout-address without a challengeId', async () => {
      const app = buildApp();
      const { providerId, providerSecret } = await onboardProvider(app);
      const newKp = Keypair.random();

      const res = await request(app)
        .patch(`/api/v3/providers/${providerId}/payout-address`)
        .set('x-provider-key', providerSecret)
        .send({ payoutAddress: newKp.publicKey() });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('challengeId');
    });

    it('creates a pending payout change with a verified challenge', async () => {
      const app = buildApp();
      const { providerId, providerSecret, keypair } = await onboardProvider(app);
      const newKp = Keypair.random();

      // Create a challenge and sign it with the new address
      const challengeRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-challenge`)
        .send({});
      const challenge = challengeRes.body.data.challenge as string;

      const signature = Buffer.from(newKp.sign(Buffer.from(challenge))).toString('base64');
      await request(app)
        .post(`/api/v3/providers/${providerId}/payout-verify`)
        .send({ signature })
        .expect(200);

      // Now request the payout change with the verified challenge
      const changeRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-change`)
        .set('x-provider-key', providerSecret)
        .send({
          newAddress: newKp.publicKey(),
          challengeId: challenge,
          coolingOffMs: 86400000,
        })
        .expect(201);

      expect(changeRes.body.data).toBeDefined();
      expect(changeRes.body.data.oldAddress).toBe(keypair.publicKey());
      expect(changeRes.body.data.newAddress).toBe(newKp.publicKey());
      expect(changeRes.body.data.status).toBe('pending');
    });

    it('rejects payout change without a verified challenge', async () => {
      const app = buildApp();
      const { providerId, providerSecret } = await onboardProvider(app);
      const newKp = Keypair.random();

      const res = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-change`)
        .set('x-provider-key', providerSecret)
        .send({
          newAddress: newKp.publicKey(),
          challengeId: 'not-a-real-challenge',
        });

      expect(res.status).toBe(400);
    });

    it('cancels a pending payout change during the cooling-off window', async () => {
      const app = buildApp();
      const { providerId, providerSecret, keypair } = await onboardProvider(app);
      const newKp = Keypair.random();

      // Create and verify a challenge
      const challengeRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-challenge`)
        .send({});
      const challenge = challengeRes.body.data.challenge as string;

      const signature = Buffer.from(newKp.sign(Buffer.from(challenge))).toString('base64');
      await request(app)
        .post(`/api/v3/providers/${providerId}/payout-verify`)
        .send({ signature })
        .expect(200);

      // Create a pending change
      const changeRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-change`)
        .set('x-provider-key', providerSecret)
        .send({
          newAddress: newKp.publicKey(),
          challengeId: challenge,
          coolingOffMs: 86400000,
        })
        .expect(201);

      const changeId = changeRes.body.data.changeId as string;

      // Cancel the pending change
      const cancelRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-change/${changeId}/cancel`)
        .set('x-provider-key', providerSecret)
        .send({})
        .expect(200);

      expect(cancelRes.body.data.status).toBe('cancelled');
      expect(cancelRes.body.data.oldAddress).toBe(keypair.publicKey());
      expect(cancelRes.body.data.newAddress).toBe(newKp.publicKey());
    });

    it('applies a pending payout change after the cooling-off window', async () => {
      const app = buildApp();
      const { providerId, providerSecret } = await onboardProvider(app);
      const newKp = Keypair.random();

      // Create and verify a challenge
      const challengeRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-challenge`)
        .send({});
      const challenge = challengeRes.body.data.challenge as string;

      const signature = Buffer.from(newKp.sign(Buffer.from(challenge))).toString('base64');
      await request(app)
        .post(`/api/v3/providers/${providerId}/payout-verify`)
        .send({ signature })
        .expect(200);

      // Create a pending change with a very short cooling-off window
      const changeRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-change`)
        .set('x-provider-key', providerSecret)
        .send({
          newAddress: newKp.publicKey(),
          challengeId: challenge,
          coolingOffMs: 0,
        })
        .expect(201);

      const changeId = changeRes.body.data.changeId as string;

      // Apply the pending change
      const applyRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-change/${changeId}/apply`)
        .set('x-provider-key', providerSecret)
        .send({})
        .expect(200);

      expect(applyRes.body.data.payoutAddress).toBe(newKp.publicKey());
    });

    it('settlements during the cooling-off window go to the old address', async () => {
      const app = buildApp();
      const { providerId, providerSecret, keypair } = await onboardProvider(app);
      const newKp = Keypair.random();

      // Create and verify a challenge
      const challengeRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-challenge`)
        .send({});
      const challenge = challengeRes.body.data.challenge as string;

      const signature = Buffer.from(newKp.sign(Buffer.from(challenge))).toString('base64');
      await request(app)
        .post(`/api/v3/providers/${providerId}/payout-verify`)
        .send({ signature })
        .expect(200);

      // Create a pending change with a long cooling-off window
      const changeRes = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-change`)
        .set('x-provider-key', providerSecret)
        .send({
          newAddress: newKp.publicKey(),
          challengeId: challenge,
          coolingOffMs: 86400000,
        })
        .expect(201);

      const changeId = changeRes.body.data.changeId as string;

      // Verify the provider still has the old payout address during the cooling-off window
      const providerRes = await request(app)
        .get(`/api/v3/providers/${providerId}`)
        .set('x-provider-key', providerSecret)
        .expect(200);

      expect(providerRes.body.data.payoutAddress).toBe(keypair.publicKey());
      expect(providerRes.body.data.payoutAddress).not.toBe(newKp.publicKey());

      // The pending change should exist
      expect(changeRes.body.data.status).toBe('pending');
      expect(changeRes.body.data.oldAddress).toBe(keypair.publicKey());
      expect(changeRes.body.data.newAddress).toBe(newKp.publicKey());
    });
  });
});
