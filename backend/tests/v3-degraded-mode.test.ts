import express from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Issue #1444 — degraded mode when the counter store is unavailable.
 *
 * The route module owns the composition root (log file, admission controller,
 * health flag), so the log path is pointed at a scratch directory and the
 * module is loaded lazily, after that env is set. Every test drives the outage
 * through `counterStoreHealth` exactly the way a store client would.
 */

const scratch = mkdtempSync(join(tmpdir(), 'syncro-degraded-'));
process.env.METER_DEGRADED_LOG_PATH = join(scratch, 'degraded-usage.jsonl');

const routerModule = require('../src/routes/v3-gateway');
const router = routerModule.default as express.Router;
const degradedAdmission = routerModule.degradedAdmission as {
  observe(): void;
  snapshot(): {
    degraded: boolean;
    logPath: string | null;
    totals: { exposureUsed: number; degradedCalls: number; rejectedCalls: number };
    providers: Array<{ providerId: string; exposureUsed: number; degradedCalls: number; rejectedCalls: number }>;
  };
};
const degradedUsageLog = routerModule.degradedUsageLog as { filePath: string };
const { counterStoreHealth } = require('../src/v3/counter-store-health') as {
  counterStoreHealth: { setAvailable(v: boolean): void; isAvailable(): boolean };
};

interface ProviderUnderTest {
  providerId: string;
  agentId: string;
}

describe('v3 gateway degraded mode (#1444)', () => {
  let app: express.Express;
  let seq = 0;

  beforeAll(() => {
    process.env.ENABLE_TESTNET_ACTIONS = 'true';
    process.env.STELLAR_NETWORK = 'testnet';
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v3', router);
    // Always leave the previous outage before arming the next one.
    setStore(true);
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

  /** Flip the counter-store health and let the controller observe the change. */
  function setStore(available: boolean): void {
    counterStoreHealth.setAvailable(available);
    degradedAdmission.observe();
  }

  function logRecordsFor(providerId: string): Array<Record<string, unknown>> {
    return readFileSync(degradedUsageLog.filePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.providerId === providerId);
  }

  async function onboard(price: number, policy?: { failMode?: 'fail_open' | 'fail_closed'; exposureCeiling?: number }): Promise<ProviderUnderTest> {
    const kp = Keypair.random();
    const suffix = (seq += 1).toString(36);
    const agentId = `agent-${suffix}`;

    const registerRes = await request(app).post('/api/v3/providers').send({
      identity: `provider-${suffix}`,
      payoutAddress: kp.publicKey(),
      upstreamBaseUrl: 'https://provider.example',
      agreementTerms: 'tos:v1',
      mode: 'staging',
      ...(policy ? { degradedMode: policy } : {}),
    });
    expect(registerRes.status).toBe(201);
    const providerId = registerRes.body.data.providerId as string;

    const challengeRes = await request(app)
      .post(`/api/v3/providers/${providerId}/payout-challenge`)
      .send({});
    const signature = Buffer.from(kp.sign(Buffer.from(challengeRes.body.data.challenge))).toString('base64');
    await request(app)
      .post(`/api/v3/providers/${providerId}/payout-verify`)
      .send({ signature })
      .expect(200);

    await request(app)
      .post(`/api/v3/providers/${providerId}/routes`)
      .send({
        pathPattern: '/echo/*',
        method: 'POST',
        unit: 'request',
        price,
        quantityExtractor: 'constant:1',
      })
      .expect(201);

    await request(app)
      .post('/api/v3/registry/grants')
      .send({ agentId, scopes: ['POST:/echo/*'] })
      .expect(201);

    return { providerId, agentId };
  }

  function paid(agentId: string, providerId: string) {
    return request(app)
      .post('/api/v3/gateway/paid')
      .set('x-syncro-agent-id', agentId)
      .send({
        providerId,
        path: '/echo/task',
        channelId: `ch-${seq}`,
        stateNonce: seq,
        rateCardVersion: 'rc-v1',
      });
  }

  it('serves fail-open during an outage, flags the response, and writes the call to the durable log', async () => {
    const { providerId, agentId } = await onboard(2);
    setStore(false);

    const res = await paid(agentId, providerId).expect(200);
    expect(res.headers['x-meter-degraded']).toBe('1');

    const records = logRecordsFor(providerId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      providerId,
      principal: agentId,
      amount: 2,
      units: 1,
      outageId: expect.any(String),
      receiptId: expect.any(String),
    });

    const snapshot = await request(app).get('/api/v3/gateway/degraded').expect(200);
    expect(snapshot.body.data.degraded).toBe(true);
    expect(snapshot.body.data.counterStoreAvailable).toBe(false);
    expect(snapshot.body.data.logPath).toBe(degradedUsageLog.filePath);
    const status = snapshot.body.data.providers.find((p: { providerId: string }) => p.providerId === providerId);
    expect(status).toMatchObject({ exposureUsed: 2, degradedCalls: 1, rejectedCalls: 0 });
  });

  it('refuses with GATEWAY_METER_DEGRADED once the exposure ceiling is reached', async () => {
    const { providerId, agentId } = await onboard(2, { exposureCeiling: 4 });
    setStore(false);

    await paid(agentId, providerId).expect(200);
    await paid(agentId, providerId).expect(200);

    const refused = await paid(agentId, providerId).expect(503);
    expect(refused.headers['retry-after']).toBe('10');
    expect(refused.body).toMatchObject({
      code: 'GATEWAY_METER_DEGRADED',
      error: 'GATEWAY_METER_DEGRADED',
      reason: 'exposure_ceiling',
    });

    const snapshot = await request(app).get('/api/v3/gateway/degraded').expect(200);
    const status = snapshot.body.data.providers.find((p: { providerId: string }) => p.providerId === providerId);
    expect(status).toMatchObject({ exposureUsed: 4, degradedCalls: 2, rejectedCalls: 1 });
    expect(snapshot.body.data.totals.rejectedCalls).toBe(1);
    expect(logRecordsFor(providerId)).toHaveLength(2);
  });

  it('refuses immediately for a fail-closed provider, without touching the upstream', async () => {
    const { providerId, agentId } = await onboard(40, { failMode: 'fail_closed' });
    setStore(false);

    const refused = await paid(agentId, providerId).expect(503);
    expect(refused.body).toMatchObject({
      code: 'GATEWAY_METER_DEGRADED',
      reason: 'fail_closed',
    });
    expect(refused.headers['retry-after']).toBe('10');
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(0);

    const snapshot = await request(app).get('/api/v3/gateway/degraded').expect(200);
    const status = snapshot.body.data.providers.find((p: { providerId: string }) => p.providerId === providerId);
    expect(status).toMatchObject({ exposureUsed: 0, rejectedCalls: 1 });
    expect(logRecordsFor(providerId)).toHaveLength(0);
  });

  it('releases held exposure when the upstream call fails', async () => {
    const { providerId, agentId } = await onboard(2, { exposureCeiling: 2 });
    setStore(false);

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('upstream down'));
    const failed = await paid(agentId, providerId).expect(400);
    expect(failed.body.error).toBe('upstream down');
    expect(logRecordsFor(providerId)).toHaveLength(0);

    // The headroom came back, so the ceiling still has room for one call.
    await paid(agentId, providerId).expect(200);
    expect(logRecordsFor(providerId)).toHaveLength(1);

    await paid(agentId, providerId).expect(503);
    expect(logRecordsFor(providerId)).toHaveLength(1);
  });

  it('recovers on the next call once the counter store is back', async () => {
    const { providerId, agentId } = await onboard(2);
    setStore(false);
    const degraded = await paid(agentId, providerId).expect(200);
    expect(degraded.headers['x-meter-degraded']).toBe('1');

    setStore(true);
    const recovered = await paid(agentId, providerId).expect(200);
    expect(recovered.headers['x-meter-degraded']).toBeUndefined();

    const snapshot = await request(app).get('/api/v3/gateway/degraded').expect(200);
    expect(snapshot.body.data.degraded).toBe(false);
    expect(snapshot.body.data.counterStoreAvailable).toBe(true);
    expect(snapshot.body.data.outageId).toBeNull();
  });

  it('updates the per-provider policy at runtime', async () => {
    const { providerId, agentId } = await onboard(2);

    const patched = await request(app)
      .patch(`/api/v3/providers/${providerId}/degraded-mode-policy`)
      .send({ failMode: 'fail_closed' })
      .expect(200);
    expect(patched.body.data).toMatchObject({ failMode: 'fail_closed', exposureCeiling: 100 });

    setStore(false);
    const refused = await paid(agentId, providerId).expect(503);
    expect(refused.body.reason).toBe('fail_closed');

    await request(app)
      .patch(`/api/v3/providers/${providerId}/degraded-mode-policy`)
      .send({ failMode: 'fail_open' })
      .expect(200);
    await paid(agentId, providerId).expect(200);

    await request(app)
      .patch(`/api/v3/providers/${providerId}/degraded-mode-policy`)
      .send({})
      .expect(400);
  });
});
