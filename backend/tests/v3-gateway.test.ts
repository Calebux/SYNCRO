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

    return { providerId };
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
});

