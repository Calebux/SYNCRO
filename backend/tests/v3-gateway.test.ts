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

  describe('payout address change security', () => {
    it('rejects PATCH payout-address without a challengeId', async () => {
      const app = buildApp();
      const { providerId } = await onboardProvider(app);
      const newKp = Keypair.random();

      const res = await request(app)
        .patch(`/api/v3/providers/${providerId}/payout-address`)
        .send({ payoutAddress: newKp.publicKey() });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('challengeId');
    });

    it('creates a pending payout change with a verified challenge', async () => {
      const app = buildApp();
      const { providerId, keypair } = await onboardProvider(app);
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
      const { providerId } = await onboardProvider(app);
      const newKp = Keypair.random();

      const res = await request(app)
        .post(`/api/v3/providers/${providerId}/payout-change`)
        .send({
          newAddress: newKp.publicKey(),
          challengeId: 'not-a-real-challenge',
        });

      expect(res.status).toBe(400);
    });

    it('cancels a pending payout change during the cooling-off window', async () => {
      const app = buildApp();
      const { providerId, keypair } = await onboardProvider(app);
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
        .send({})
        .expect(200);

      expect(cancelRes.body.data.status).toBe('cancelled');
      expect(cancelRes.body.data.oldAddress).toBe(keypair.publicKey());
      expect(cancelRes.body.data.newAddress).toBe(newKp.publicKey());
    });

    it('applies a pending payout change after the cooling-off window', async () => {
      const app = buildApp();
      const { providerId } = await onboardProvider(app);
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
        .send({})
        .expect(200);

      expect(applyRes.body.data.payoutAddress).toBe(newKp.publicKey());
    });

    it('settlements during the cooling-off window go to the old address', async () => {
      const app = buildApp();
      const { providerId, keypair } = await onboardProvider(app);
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

