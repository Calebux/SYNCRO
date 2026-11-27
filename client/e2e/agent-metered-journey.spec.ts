import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createPaidFetch } from '../../sdk/src/v3/paid-fetch';

/**
 * v3 metered-rails journey (issue #1678):
 * sign in (principal key) → register an agent → set a spend cap →
 * trigger a paid call through the SDK → see it in usage with a receipt link.
 *
 * Backend v3 endpoints are stubbed at the HTTP boundary so the journey runs
 * hermetically against the local stack in well under three minutes. The paid
 * call goes through the real SDK `createPaidFetch` 402 flow against a stub
 * x402 gateway (402 challenge → signed retry → receipt).
 */

const API = '**/api/v3/**';

interface StubAgent {
  agentId: string;
  label: string | null;
  publicKey: string;
  status: 'active';
  revokedAt: null;
  inFlightCalls: number;
  allowedCalls: string[];
  scopeIds: string[];
  spendAndLimit: { spentPlain: string; limitPlain: string; together: string };
  revocation: { stops: string; continues: string };
}

const CALL_TYPES = [
  { id: 'inference', label: 'Inference', detail: 'Metered model calls' },
];

function blankAgent(publicKey: string, label: string | null): StubAgent {
  return {
    agentId: 'agent-1',
    label,
    publicKey,
    status: 'active',
    revokedAt: null,
    inFlightCalls: 0,
    allowedCalls: [],
    scopeIds: [],
    spendAndLimit: {
      spentPlain: '0 USDC',
      limitPlain: 'No limit',
      together: 'Spent 0 USDC of no limit.',
    },
    revocation: {
      stops: 'Revoking stops new calls immediately.',
      continues: 'Settled calls remain settled.',
    },
  };
}

test.describe('v3 metered journey', () => {
  test('sign in → register agent → set cap → paid call → usage with receipt', async ({ page }) => {
    test.setTimeout(120_000);

    // --- Stub x402 gateway for the SDK paid call (node side) ---
    const txId = `tx-${Date.now()}`;
    let gatewayHits = 0;
    const gateway = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        gatewayHits += 1;
        if (!req.headers['payment-signature']) {
          const required = {
            x402Version: 2,
            accepts: [{ scheme: 'exact', network: 'stellar', amount: '0.10', asset: 'USDC', payTo: 'GPROVIDER' }],
          };
          res.writeHead(402, {
            'content-type': 'application/json',
            'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(required)).toString('base64'),
          });
          res.end('{}');
          return;
        }
        const receipt = { success: true, transaction: txId, network: 'stellar' };
        res.writeHead(200, {
          'content-type': 'application/json',
          'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(receipt)).toString('base64'),
        });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    const gatewayPort = (gateway.address() as { port: number }).port;

    // --- Paid call through the SDK ---
    const paidFetch = createPaidFetch({ sign: async () => 'test-signature' });
    const paidRes = await paidFetch(`http://127.0.0.1:${gatewayPort}/inference`, { method: 'POST' });
    expect(paidRes.status).toBe(200);
    expect(gatewayHits).toBe(2); // 402 challenge + signed retry
    const receipt = (paidRes as { receipt?: { success: boolean; transaction?: string } }).receipt;
    expect(receipt?.success).toBe(true);
    expect(receipt?.transaction).toBe(txId);

    // --- Stub backend v3 API (browser side) ---
    const agents: StubAgent[] = [];
    const receiptUrl = `http://localhost:3001/api/v3/receipts/${txId}`;

    await page.route(API, async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

      if (url.endsWith('/session/challenge') && method === 'POST') {
        await ok({ challengeId: 'ch-1', message: 'sign-in-challenge' });
        return;
      }
      if (url.endsWith('/agents/session') && method === 'POST') {
        const body = req.postDataJSON() as { publicKey: string };
        await ok({ token: 'principal-token', publicKey: body.publicKey });
        return;
      }
      if (url.endsWith('/api/v3/agents') && method === 'GET') {
        await ok({ callTypes: CALL_TYPES, agents });
        return;
      }
      if (url.endsWith('/api/v3/agents') && method === 'POST') {
        const body = req.postDataJSON() as { publicKey: string; label: string | null };
        const agent = blankAgent(body.publicKey, body.label);
        agents.unshift(agent);
        await ok(agent);
        return;
      }
      const previewMatch = url.match(/\/agents\/([^/]+)\/authority\/preview$/);
      if (previewMatch && method === 'POST') {
        const draft = req.postDataJSON() as { amount: number; period: string };
        await ok({
          statement: `Grant agent-1 ${draft.amount} USDC per ${draft.period}.`,
          before: 'No spending authority.',
          after: `${draft.amount} USDC per ${draft.period}.`,
          requiresReauthentication: false,
          confirmation: `You are granting ${draft.amount} USDC per ${draft.period}.`,
          agentPublicKey: agents[0]?.publicKey ?? '',
        });
        return;
      }
      const applyMatch = url.match(/\/agents\/([^/]+)\/authority$/);
      if (applyMatch && method === 'POST') {
        const draft = req.postDataJSON() as { amount: number; period: string; scopeIds: string[] };
        const agent = agents[0];
        agent.scopeIds = draft.scopeIds;
        agent.allowedCalls = CALL_TYPES.filter((c) => draft.scopeIds.includes(c.id)).map((c) => c.label);
        agent.spendAndLimit = {
          spentPlain: '0 USDC',
          limitPlain: `${draft.amount} USDC`,
          together: `Spent 0 USDC of ${draft.amount} USDC.`,
        };
        await ok(agent);
        return;
      }
      await route.continue();
    });

    await page.route('**/api/analytics/v3/usage', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { calls: [{ agentId: 'agent-1', amount: '0.10', receiptId: txId, receiptUrl }] },
        }),
      });
    });
    await page.route('**/api/v3/receipts/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { transaction: txId, network: 'stellar' } }),
      });
    });

    // --- 1. Sign in with a principal key ---
    await page.goto('/agents');
    await page.getByRole('button', { name: /generate a principal key/i }).click();
    await page.getByRole('button', { name: /i have stored this key/i }).click();
    await expect(page.getByText(/signed in/i)).toBeVisible();

    // --- 2. Register an agent ---
    await page.fill('#agent-name', 'e2e-agent');
    await page.getByRole('button', { name: /generate a new agent key/i }).click();
    await page.getByRole('button', { name: /register this agent/i }).click();
    await expect(page.getByRole('heading', { name: 'e2e-agent' })).toBeVisible();

    // --- 3. Set a spend cap ---
    await page.getByRole('button', { name: /set spending authority/i }).click();
    await page.getByText('Inference').first().click();
    await page.locator('input[id^="amount-"]').fill('25');
    await page.getByRole('button', { name: /review change/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.fill('#principal-secret', 'SFAKEPRINCIPALSECRET');
    await page.getByRole('button', { name: /sign and apply/i }).click();
    await expect(page.getByText('25 USDC')).toBeVisible();

    // --- 4. Paid call appears in usage with a receipt link ---
    const usage = await page.evaluate(async () => {
      const res = await fetch('/api/analytics/v3/usage');
      return res.json();
    });
    const calls = usage.data.calls as Array<{ receiptId: string; receiptUrl: string }>;
    expect(calls).toHaveLength(1);
    expect(calls[0].receiptId).toBe(txId);
    expect(calls[0].receiptUrl).toContain(txId);

    await page.goto(calls[0].receiptUrl);
    await expect(page.getByText(txId)).toBeVisible();
    gateway.close();
  });
});
