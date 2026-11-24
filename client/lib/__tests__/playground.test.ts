import { describe, expect, it } from 'vitest';
import { dashboardNav } from '../dashboard-nav';
import { describeGatewayUnavailable, getPlaygroundQuote } from '../playground-quote';
import {
  DEMO_PROVIDER,
  channelBalanceForQuote,
  channelStateProofMessage,
  encodeJsonHeader,
  loadPlaygroundProviders,
  playgroundSpendAmount,
  runPlaygroundCall,
  selectPlaygroundProvider,
  type PlaygroundSigner,
} from '../playground-call';

const ORIGIN = 'http://gateway.test';
const PAYER = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function challengeBody(amount = '8', chain = 'stellar:testnet') {
  return {
    challenge: {
      challengeId: 'chal_1',
      scheme: 'channel-state',
      chain,
      contract: 'C_TEST',
      channelAddress: 'G_PROVIDER_CHANNEL_DEFAULT',
      settlementAsset: 'USDC:TEST',
      amount,
      rate: '8',
      nonce: 'ch_nonce_1',
      expiresAt: '2099-01-01T00:00:00.000Z',
      signature: 'gateway-sig',
    },
  };
}

function receipt(cost = 8) {
  return {
    receiptId: 'rcpt_1',
    requestHash: 'ab'.repeat(32),
    cost,
    unitName: 'calls',
    units: 1,
    fallbackUsed: false,
    issuedAt: '2026-11-24T00:00:00.000Z',
    providerSignature: 'sig_prov_abc',
  };
}

function routeFetch(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const calls: { method: string; path: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, path: url.pathname, init });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return json(404, { message: `No route for ${method} ${url.pathname}` });
    return handler(init);
  };
  return { fetchImpl, calls };
}

function signer(): PlaygroundSigner & { messages: string[] } {
  const messages: string[] = [];
  return {
    publicKey: PAYER,
    messages,
    async sign(message: string) {
      messages.push(message);
      return `signed:${messages.length}`;
    },
  };
}

const admitted = {
  'POST /api/v3/agents/session/challenge': () => json(200, { data: { challengeId: 'c1', message: 'sign-in' } }),
  'POST /api/v3/agents/session': () => json(200, { data: { token: 'session-token' } }),
  'POST /api/v3/agents': () => json(201, { data: { agentId: 'agent-1' } }),
  'POST /api/v3/agents/agent-1/authority/preview': () => json(200, {
    data: { statement: 'allow spending', requiresReauthentication: true },
  }),
  'POST /api/v3/agents/reauth/challenge': () => json(200, { data: { challengeId: 'r1', message: 'confirm' } }),
  'POST /api/v3/agents/reauth': () => json(200, { data: { reauthToken: 'reauth-token' } }),
  'POST /api/v3/agents/agent-1/authority': () => json(200, { data: { agentId: 'agent-1' } }),
};

describe('paid-call quote', () => {
  it('accepts a quote that matches the budget exactly', async () => {
    const quote = await getPlaygroundQuote(ORIGIN, '8', async () => json(402, challengeBody('8')));
    expect(quote.amount).toBe('8');
    expect(quote.asset).toBe('USDC:TEST');
  });

  it('accepts a quote one stroop under the budget and rejects one stroop over', async () => {
    await expect(getPlaygroundQuote(ORIGIN, '1.0000001', async () => json(402, challengeBody('1')))).resolves.toMatchObject({
      amount: '1',
    });
    await expect(getPlaygroundQuote(ORIGIN, '1', async () => json(402, challengeBody('1.0000001')))).rejects.toThrow(
      'The quoted cost exceeds the selected budget.',
    );
  });

  it('rejects a mainnet challenge and a zero budget', async () => {
    await expect(getPlaygroundQuote(ORIGIN, '8', async () => json(402, challengeBody('8', 'stellar:mainnet')))).rejects.toThrow(
      'unsupported challenge',
    );
    await expect(getPlaygroundQuote(ORIGIN, '0', async () => json(402, challengeBody()))).rejects.toThrow(
      'The budget must be positive.',
    );
  });

  it('explains a 503 from the gateway', async () => {
    await expect(getPlaygroundQuote(ORIGIN, '8', async () => json(503, {
      error: 'Payment challenge unavailable',
      message: 'No payment contract is configured for this network',
    }))).rejects.toThrow(
      'The gateway returned 503. No payment contract is configured for this network',
    );
    expect(describeGatewayUnavailable(null)).toBe('The gateway returned 503 and did not explain why.');
  });
});

describe('provider catalog', () => {
  it('uses the seeded demo provider when the catalog is missing', async () => {
    const missing = await loadPlaygroundProviders(ORIGIN, async () => json(404, { message: 'missing' }));
    const failed = await loadPlaygroundProviders(ORIGIN, async () => { throw new Error('offline'); });
    expect(missing.providers).toEqual([DEMO_PROVIDER]);
    expect(missing.usedFallback).toBe(true);
    expect(missing.note).toContain('mock/echo');
    expect(failed.providers[0]?.route).toBe('mock/echo');
  });

  it('wires the dropdown to the catalog and prefers the demo provider', async () => {
    const catalog = await loadPlaygroundProviders(ORIGIN, async () => json(200, {
      providers: [
        { id: 'other', name: 'Other', route: 'mock/other' },
        { id: DEMO_PROVIDER.id, name: 'v3 mock provider', route: DEMO_PROVIDER.route },
      ],
    }));
    expect(catalog.usedFallback).toBe(false);
    expect(catalog.providers.map((provider) => provider.id)).toEqual([DEMO_PROVIDER.id, 'other']);
    expect(selectPlaygroundProvider(catalog.providers, 'other').route).toBe('mock/other');
    const empty = await loadPlaygroundProviders(ORIGIN, async () => json(200, { providers: [] }));
    expect(empty.usedFallback).toBe(true);
  });
});

describe('paid call', () => {
  it('signs with the testnet agent, posts the proxy, and verifies the receipt', async () => {
    const paid = receipt();
    const { fetchImpl, calls } = routeFetch({
      'GET /api/v3/gateway/challenge': () => json(402, challengeBody()),
      ...admitted,
      'POST /api/v3/gateway/proxy': () => json(200, { status: 'success', receipt: paid }, {
        'payment-response': btoa(JSON.stringify(paid)),
      }),
    });
    const agent = signer();
    const run = await runPlaygroundCall({
      apiOrigin: ORIGIN,
      budget: '20',
      provider: DEMO_PROVIDER,
      signer: agent,
      prompt: 'hello',
      sequenceNumber: 1700000000000,
      fetchImpl,
    });

    const message = 'G_PROVIDER_CHANNEL_DEFAULT:1700000000000:5000:0:ch_nonce_1:' + PAYER;
    expect(channelStateProofMessage(run.signed.proof)).toBe(message);
    expect(agent.messages[0]).toBe(message);
    expect(run.admission.granted).toBe(true);
    expect(run.verification.ok).toBe(true);
    expect(run.steps.map((step) => step.status)).toEqual(['complete', 'complete', 'complete', 'complete']);
    expect(run.sdkSnippet).toContain('/api/v3/gateway/proxy');
    expect(run.sdkSnippet).toContain('mock/echo');
    expect(run.sdkSnippet).toContain(PAYER);
    expect(run.sdkSnippet).toContain('"hello"');
    expect(run.sdkSnippet).toContain('"20"');

    const proxy = calls.find((call) => call.path === '/api/v3/gateway/proxy');
    expect(proxy?.method).toBe('POST');
    expect(JSON.parse(String(proxy?.init?.body))).toEqual({ route: 'mock/echo', input: 'hello' });
    const headers = new Headers(proxy?.init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${PAYER}`);
    expect(headers.get('payment-signature')).toBe(encodeJsonHeader(run.signed.proof));
    const authority = calls.find((call) => call.path === '/api/v3/agents/agent-1/authority');
    expect(JSON.parse(String(authority?.init?.body)).amount).toBe(20);
    expect(new Headers(authority?.init?.headers).get('authorization')).toBe('Bearer session-token');
  });

  it('still posts the signed payment when the agent API is unavailable', async () => {
    const { fetchImpl, calls } = routeFetch({
      'GET /api/v3/gateway/challenge': () => json(402, challengeBody()),
      'POST /api/v3/agents/session/challenge': () => json(404, { message: 'missing' }),
      'POST /api/v3/gateway/proxy': () => json(402, { error: 'Spend cap admission failed', reason: 'No spend cap record' }),
    });
    const run = await runPlaygroundCall({
      apiOrigin: ORIGIN,
      budget: '20',
      provider: DEMO_PROVIDER,
      signer: signer(),
      sequenceNumber: 4,
      fetchImpl,
    });
    expect(run.admission.granted).toBe(false);
    expect(run.admission.detail).toContain('not available');
    expect(calls.some((call) => call.path === '/api/v3/gateway/proxy')).toBe(true);
    expect(run.steps.find((step) => step.id === 'response')?.status).toBe('failed');
    expect(run.verification.ok).toBe(false);
    expect(run.verification.failures.join(' ')).toContain('No spend cap record');
  });

  it('shows a clear message when the proxy returns 503', async () => {
    const { fetchImpl } = routeFetch({
      'GET /api/v3/gateway/challenge': () => json(402, challengeBody()),
      'POST /api/v3/agents/session/challenge': () => json(404, { message: 'missing' }),
      'POST /api/v3/gateway/proxy': () => json(503, {
        error: 'Metering unavailable — request not accepted',
        code: 'METER_RESERVATION_UNAVAILABLE',
      }),
    });
    const run = await runPlaygroundCall({
      apiOrigin: ORIGIN,
      budget: '20',
      provider: DEMO_PROVIDER,
      signer: signer(),
      sequenceNumber: 5,
      fetchImpl,
    });
    expect(run.unavailable).toBe('The gateway returned 503. Metering unavailable — request not accepted');
    expect(run.steps.find((step) => step.id === 'response')?.detail).toContain('The gateway returned 503.');
    expect(run.verification.ok).toBe(false);
  });

  it('rejects a receipt that does not match the header or the quote', async () => {
    const bodyReceipt = receipt(8);
    const headerReceipt = receipt(1);
    const { fetchImpl } = routeFetch({
      'GET /api/v3/gateway/challenge': () => json(402, challengeBody()),
      'POST /api/v3/agents/session/challenge': () => json(404, {}),
      'POST /api/v3/gateway/proxy': () => json(200, { receipt: bodyReceipt }, {
        'payment-response': btoa(JSON.stringify(headerReceipt)),
      }),
    });
    const mismatched = await runPlaygroundCall({
      apiOrigin: ORIGIN,
      budget: '20',
      provider: DEMO_PROVIDER,
      signer: signer(),
      sequenceNumber: 6,
      fetchImpl,
    });
    expect(mismatched.verification.ok).toBe(false);
    expect(mismatched.verification.failures.join(' ')).toContain('does not match');

    const over = receipt(9);
    const overFetch = routeFetch({
      'GET /api/v3/gateway/challenge': () => json(402, challengeBody()),
      'POST /api/v3/agents/session/challenge': () => json(404, {}),
      'POST /api/v3/gateway/proxy': () => json(200, { receipt: over }, {
        'payment-response': btoa(JSON.stringify(over)),
      }),
    });
    const overQuote = await runPlaygroundCall({
      apiOrigin: ORIGIN,
      budget: '20',
      provider: DEMO_PROVIDER,
      signer: signer(),
      sequenceNumber: 7,
      fetchImpl: overFetch.fetchImpl,
    });
    expect(overQuote.verification.failures.join(' ')).toContain('above the quoted amount');
  });
});

describe('playground amounts', () => {
  it('keeps the demo channel balance above a normal quote and sizes the spend cap', () => {
    expect(channelBalanceForQuote('8')).toBe(5000);
    expect(channelBalanceForQuote('5000.2')).toBe(5001);
    expect(playgroundSpendAmount('8', '20')).toBe(20);
    expect(playgroundSpendAmount('8', '8')).toBe(8);
    expect(playgroundSpendAmount('8.001', '8.009')).toBe(8.01);
  });
});

describe('dashboard nav', () => {
  it('links the principal console to the playground', () => {
    expect(dashboardNav).toContainEqual({ href: '/dashboard/playground', label: 'Playground', id: 'playground' });
  });
});
