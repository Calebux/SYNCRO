import express from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { createAgentConsoleRouter } from '../src/routes/v3/agents';
import { createV3GatewayRouter } from '../src/routes/v3/gateway';
import {
  AgentConsoleService,
  REVOKE_CONTINUES,
  REVOKE_STOPS,
  agentConsoleService,
} from '../src/v3/agent-console-service';
import { spendCapService } from '../src/services/v3/spend-cap-service';
import { meterReservationTracker } from '../src/services/v3/gateway-lifecycle';
import {
  challengeNonceStore,
  defaultChannelStateStore,
} from '../src/services/v3/payment-challenge-service';

function sign(keypair: Keypair, message: string): string {
  return Buffer.from(keypair.sign(Buffer.from(message, 'utf8'))).toString('base64');
}

function buildApp(service: AgentConsoleService = agentConsoleService) {
  const app = express();
  app.use(express.json());
  app.use('/api/v3/agents', createAgentConsoleRouter(service));
  app.use('/api/v3/gateway', createV3GatewayRouter());
  return app;
}

async function signIn(app: express.Express, keypair: Keypair): Promise<string> {
  const challenge = await request(app)
    .post('/api/v3/agents/session/challenge')
    .send({ publicKey: keypair.publicKey() })
    .expect(200);
  const session = await request(app)
    .post('/api/v3/agents/session')
    .send({
      challengeId: challenge.body.data.challengeId,
      publicKey: keypair.publicKey(),
      signature: sign(keypair, challenge.body.data.message),
    })
    .expect(200);
  return session.body.data.token as string;
}

async function applyAuthority(
  app: express.Express,
  token: string,
  principal: Keypair,
  agentId: string,
  body: { scopeIds: string[]; amount: number; period: 'day' | 'week' | 'month' },
  options: { reauth: boolean },
) {
  const preview = await request(app)
    .post(`/api/v3/agents/${agentId}/authority/preview`)
    .set('authorization', `Bearer ${token}`)
    .send(body)
    .expect(200);

  let reauthToken: string | undefined;
  if (options.reauth) {
    const challenge = await request(app)
      .post('/api/v3/agents/reauth/challenge')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const confirmed = await request(app)
      .post('/api/v3/agents/reauth')
      .set('authorization', `Bearer ${token}`)
      .send({
        challengeId: challenge.body.data.challengeId,
        signature: sign(principal, challenge.body.data.message),
        statement: preview.body.data.statement,
      })
      .expect(200);
    reauthToken = confirmed.body.data.reauthToken as string;
  }

  return {
    preview: preview.body.data,
    response: await request(app)
      .post(`/api/v3/agents/${agentId}/authority`)
      .set('authorization', `Bearer ${token}`)
      .send({
        ...body,
        statement: preview.body.data.statement,
        signature: sign(principal, preview.body.data.statement),
        reauthToken,
      }),
  };
}

describe('agent console grant lifecycle', () => {
  beforeEach(() => {
    agentConsoleService.reset();
    spendCapService.clear();
    meterReservationTracker.clear();
    challengeNonceStore.clear();
    defaultChannelStateStore.clear();
  });

  it('grants, shows spend beside the limit, and refuses a raise without a fresh confirmation', async () => {
    const app = buildApp();
    const principal = Keypair.random();
    const agentKey = Keypair.random();
    const token = await signIn(app, principal);

    const registered = await request(app)
      .post('/api/v3/agents')
      .set('authorization', `Bearer ${token}`)
      .send({ publicKey: agentKey.publicKey(), label: 'Research' })
      .expect(201);

    expect(registered.body.data.publicKey).toBe(agentKey.publicKey());
    expect(registered.body.data.spendAndLimit.together).toContain('No spending limit yet');

    const first = await applyAuthority(
      app,
      token,
      principal,
      registered.body.data.agentId,
      { scopeIds: ['llm:call'], amount: 10, period: 'month' },
      { reauth: true },
    );
    expect(first.preview.before).toBe('No spending authority');
    expect(first.preview.after).toBe('Language model calls, up to 10.00 USDC every month');
    expect(first.preview.requiresReauthentication).toBe(true);
    expect(first.preview.statement).toContain('Allowed calls: Language model calls');
    expect(first.preview.statement).not.toMatch(/scope|cap|nonce/i);
    expect(first.response.status).toBe(200);
    expect(first.response.body.data.spendAndLimit.together).toBe(
      '0.00 USDC spent toward a 10.00 USDC limit every month.',
    );

    const withoutConfirmation = await applyAuthority(
      app,
      token,
      principal,
      registered.body.data.agentId,
      { scopeIds: ['llm:call'], amount: 10, period: 'day' },
      { reauth: false },
    );
    expect(withoutConfirmation.preview.requiresReauthentication).toBe(true);
    expect(withoutConfirmation.response.status).toBe(403);
    expect(withoutConfirmation.response.body.error).toBe('reauthentication_required');

    const reduced = await applyAuthority(
      app,
      token,
      principal,
      registered.body.data.agentId,
      { scopeIds: ['llm:call'], amount: 5, period: 'month' },
      { reauth: false },
    );
    expect(reduced.preview.requiresReauthentication).toBe(false);
    expect(reduced.response.status).toBe(200);
    expect(reduced.response.body.data.spendAndLimit.limitPlain).toBe('5.00 USDC every month');
    expect(reduced.response.body.data.spendAndLimit.spentPlain).toBe('0.00 USDC this month');
  });

  it('rejects a reused confirmation and a signature over different words', async () => {
    const app = buildApp();
    const principal = Keypair.random();
    const token = await signIn(app, principal);
    const registered = await request(app)
      .post('/api/v3/agents')
      .set('authorization', `Bearer ${token}`)
      .send({ publicKey: Keypair.random().publicKey() })
      .expect(201);
    const agentId = registered.body.data.agentId as string;
    const body = { scopeIds: ['data:read'], amount: 25, period: 'day' as const };

    const preview = await request(app)
      .post(`/api/v3/agents/${agentId}/authority/preview`)
      .set('authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);

    const challenge = await request(app)
      .post('/api/v3/agents/reauth/challenge')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const confirmed = await request(app)
      .post('/api/v3/agents/reauth')
      .set('authorization', `Bearer ${token}`)
      .send({
        challengeId: challenge.body.data.challengeId,
        signature: sign(principal, challenge.body.data.message),
        statement: preview.body.data.statement,
      })
      .expect(200);

    const applied = await request(app)
      .post(`/api/v3/agents/${agentId}/authority`)
      .set('authorization', `Bearer ${token}`)
      .send({
        ...body,
        statement: preview.body.data.statement,
        signature: sign(principal, preview.body.data.statement),
        reauthToken: confirmed.body.data.reauthToken,
      })
      .expect(200);

    expect(applied.body.data.allowedCalls).toEqual(['Data lookups']);

    const raised = await request(app)
      .post(`/api/v3/agents/${agentId}/authority/preview`)
      .set('authorization', `Bearer ${token}`)
      .send({ scopeIds: ['data:read', 'llm:call'], amount: 40, period: 'day' })
      .expect(200);

    const reused = await request(app)
      .post(`/api/v3/agents/${agentId}/authority`)
      .set('authorization', `Bearer ${token}`)
      .send({
        scopeIds: ['data:read', 'llm:call'],
        amount: 40,
        period: 'day',
        statement: raised.body.data.statement,
        signature: sign(principal, raised.body.data.statement),
        reauthToken: confirmed.body.data.reauthToken,
      });
    expect(reused.status).toBe(403);
    expect(reused.body.error).toBe('reauthentication_mismatch');

    const mismatched = await request(app)
      .post(`/api/v3/agents/${agentId}/authority`)
      .set('authorization', `Bearer ${token}`)
      .send({
        ...body,
        statement: `${preview.body.data.statement}\nLimit: 1.00 USDC every day`,
        signature: sign(principal, preview.body.data.statement),
      });
    expect(mismatched.status).toBe(409);
    expect(mismatched.body.error).toBe('statement_mismatch');
  });

  it('revokes immediately, leaves in-flight calls running, and blocks the next paid call', async () => {
    const app = buildApp();
    const principal = Keypair.random();
    const agentKey = Keypair.random();
    const token = await signIn(app, principal);
    const registered = await request(app)
      .post('/api/v3/agents')
      .set('authorization', `Bearer ${token}`)
      .send({ publicKey: agentKey.publicKey() })
      .expect(201);
    const agentId = registered.body.data.agentId as string;

    await applyAuthority(
      app,
      token,
      principal,
      agentId,
      { scopeIds: ['llm:call'], amount: 25, period: 'day' },
      { reauth: true },
    );

    const reservationId = meterReservationTracker.reserve(agentKey.publicKey(), '/proxy', 10);
    defaultChannelStateStore.setChannelMembers('chan_agent', { payer: 'G_PAYER', provider: 'G_PROVIDER' });
    defaultChannelStateStore.setLatestSequence('chan_agent', 1);

    const proof = Buffer.from(JSON.stringify({
      channelId: 'chan_agent',
      sequenceNumber: 2,
      userBalance: 100,
      executorBalance: 50,
      totalDeposited: 150,
      nonce: 'agent-console-nonce',
      signature: 'mock_valid_signature',
      payerAddress: 'G_PAYER',
    })).toString('base64');

    const paid = await request(app)
      .post('/api/v3/gateway/proxy')
      .set('Authorization', `Bearer ${agentKey.publicKey()}`)
      .set('PAYMENT-SIGNATURE', proof)
      .send({ prompt: 'hello' });
    expect(paid.status).toBe(200);

    const listed = await request(app)
      .get('/api/v3/agents')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const agent = listed.body.data.agents[0];
    expect(agent.spendAndLimit.spentPlain).toBe('8.00 USDC today');
    expect(agent.spendAndLimit.limitPlain).toBe('25.00 USDC every day');
    expect(agent.spendAndLimit.together).toBe('8.00 USDC spent toward a 25.00 USDC limit every day.');
    expect(agent.inFlightCalls).toBe(1);
    expect(agent.revocation.stops).toBe(REVOKE_STOPS);
    expect(agent.revocation.continues).toBe(REVOKE_CONTINUES);

    const revoked = await request(app)
      .post(`/api/v3/agents/${agentId}/revoke`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(revoked.body.data.status).toBe('revoked');
    expect(revoked.body.data.revocation.stops).toBe(REVOKE_STOPS);
    expect(revoked.body.data.revocation.continues).toBe(REVOKE_CONTINUES);
    expect(revoked.body.data.inFlightCalls).toBe(1);
    expect(meterReservationTracker.get(reservationId)?.status).toBe('reserved');
    expect(spendCapService.getCap(agentKey.publicKey())?.status).toBe('closed');
    expect(spendCapService.canTransact(agentKey.publicKey(), 1).canTransact).toBe(false);

    const blocked = await request(app)
      .post('/api/v3/gateway/proxy')
      .set('Authorization', `Bearer ${agentKey.publicKey()}`)
      .set('PAYMENT-SIGNATURE', proof)
      .send({ prompt: 'again' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('agent_revoked');

    const regrant = await request(app)
      .post(`/api/v3/agents/${agentId}/authority/preview`)
      .set('authorization', `Bearer ${token}`)
      .send({ scopeIds: ['llm:call'], amount: 1, period: 'day' });
    expect(regrant.status).toBe(409);
    expect(regrant.body.error).toBe('agent_revoked');
  });

  it('expires a sign-in challenge on the server clock', async () => {
    let now = Date.parse('2026-09-25T12:00:00.000Z');
    const service = new AgentConsoleService(() => now);
    const app = buildApp(service);
    const principal = Keypair.random();
    const challenge = await request(app)
      .post('/api/v3/agents/session/challenge')
      .send({ publicKey: principal.publicKey() })
      .expect(200);

    now += 3 * 60 * 1000;
    const expired = await request(app)
      .post('/api/v3/agents/session')
      .send({
        challengeId: challenge.body.data.challengeId,
        publicKey: principal.publicKey(),
        signature: sign(principal, challenge.body.data.message),
      });
    expect(expired.status).toBe(400);
    expect(expired.body.error).toBe('challenge_expired');
  });
});
