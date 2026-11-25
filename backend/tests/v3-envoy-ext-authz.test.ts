import { describe, expect, it, vi } from 'vitest';
import {
  AdmittedCall,
  CheckRequest,
  EnvoyExtAuthzService,
  EXT_AUTHZ_HEADERS as H,
  ExtAuthzDeps,
} from '../src/v3/ext-authz/envoy-ext-authz';

const SECRET = 'envoy-shared-secret';

const call: AdmittedCall = {
  agentId: 'agent_1',
  reservationId: 'res_1',
  routePath: '/api/v3/gateway/inference',
  unitName: 'tokens',
  unitPrice: 0.1,
  reservationBound: 100,
  priceUpperBound: 10,
  channelId: 'chan_1',
  stateNonce: 7,
  requestMethod: 'POST',
  requestPath: '/inference',
  requestQuery: {},
};

const checkRequest: CheckRequest = {
  method: 'POST',
  path: '/inference',
  query: {},
  headers: { authorization: 'Bearer agent_1', 'payment-signature': 'proof' },
  body: { prompt: 'hi' },
};

const unpaid402 = {
  admitted: false as const,
  status: 402,
  headers: { 'payment-required': 'b64challenge', 'content-type': 'application/json' },
  body: { error: 'Payment required', challenge: { amount: '10' } },
};

function makeDeps(overrides: Partial<ExtAuthzDeps> = {}) {
  const deps = {
    admit: vi.fn(async () => ({ admitted: true as const, call })),
    measure: vi.fn(async () => ({ units: 42, amount: 4.2, fallbackUsed: false })),
    commit: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    issueReceipt: vi.fn(async () => ({ receiptId: 'rcpt_1', inlineHeader: 'inline-receipt' })),
    onError: vi.fn(),
    ...overrides,
  };
  return deps;
}

function makeService(deps: ExtAuthzDeps, opts: { secret?: string; ttl?: number } = {}) {
  return new EnvoyExtAuthzService(deps, {
    sharedSecret: 'secret' in opts ? opts.secret : SECRET,
    pendingTtlMs: opts.ttl,
  });
}

describe('EnvoyExtAuthzService authentication', () => {
  it('fails closed when no shared secret is configured', () => {
    const service = makeService(makeDeps(), { secret: undefined });
    expect(service.isConfigured()).toBe(false);
    expect(service.authenticate(undefined)).toBe(false);
    expect(service.authenticate('')).toBe(false);
  });

  it('accepts only the exact secret', () => {
    const service = makeService(makeDeps());
    expect(service.authenticate(SECRET)).toBe(true);
    expect(service.authenticate(`${SECRET}x`)).toBe(false);
    expect(service.authenticate('wrong')).toBe(false);
    expect(service.authenticate(undefined)).toBe(false);
  });
});

describe('EnvoyExtAuthzService.check', () => {
  it('passes an unpaid 402 challenge through unchanged', async () => {
    const deps = makeDeps({ admit: vi.fn(async () => unpaid402) });
    const reply = await makeService(deps).check(checkRequest);

    expect(reply).toEqual({ status: 402, headers: unpaid402.headers, body: unpaid402.body });
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('allows a paid call and injects identity and reservation headers', async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const reply = await service.check(checkRequest);

    expect(deps.admit).toHaveBeenCalledWith(checkRequest);
    expect(reply.status).toBe(200);
    expect(reply.body).toBeUndefined();
    expect(reply.headers).toEqual({
      [H.agentId]: 'agent_1',
      [H.reservationId]: 'res_1',
      [H.route]: '/api/v3/gateway/inference',
    });
    expect(service.pendingCount()).toBe(1);
  });

  it('turns an admission exception into a retryable 500 deny', async () => {
    const deps = makeDeps({ admit: vi.fn(async () => { throw new Error('redis down'); }) });
    const reply = await makeService(deps).check(checkRequest);

    expect(reply.status).toBe(500);
    expect(reply.headers['retry-after']).toBe('5');
    expect(reply.body).toMatchObject({ code: 'GATEWAY_INTERNAL', retryable: true });
    expect(deps.onError).toHaveBeenCalled();
  });
});

describe('EnvoyExtAuthzService.settle', () => {
  const ok = { status: 200, headers: {}, body: { usage: { total_tokens: 42 } } };

  it('commits measured usage and returns receipt headers', async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await service.check(checkRequest);

    const reply = await service.settle('res_1', ok);

    expect(deps.measure).toHaveBeenCalledWith(call, ok);
    expect(deps.commit).toHaveBeenCalledWith(call, { units: 42, amount: 4.2, fallbackUsed: false });
    expect(reply.status).toBe(200);
    expect(reply.headers).toEqual({
      [H.receipt]: 'inline-receipt',
      [H.receiptUrl]: '/api/v3/receipts/rcpt_1',
    });
    expect(reply.body).toEqual({ receiptId: 'rcpt_1', units: 42, amount: 4.2 });
    expect(service.pendingCount()).toBe(0);
  });

  it('omits the inline receipt when it does not fit in a header', async () => {
    const deps = makeDeps({ issueReceipt: vi.fn(async () => ({ receiptId: 'rcpt_big', inlineHeader: null })) });
    const service = makeService(deps);
    await service.check(checkRequest);

    const reply = await service.settle('res_1', ok);
    expect(reply.headers).toEqual({ [H.receiptUrl]: '/api/v3/receipts/rcpt_big' });
  });

  it('is single-use: a replayed settle is rejected and does not double-charge', async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await service.check(checkRequest);

    await service.settle('res_1', ok);
    const replay = await service.settle('res_1', ok);

    expect(replay.status).toBe(404);
    expect(deps.commit).toHaveBeenCalledTimes(1);
    expect(deps.issueReceipt).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown or missing reservation ids', async () => {
    const service = makeService(makeDeps());
    expect((await service.settle('res_nope', ok)).status).toBe(404);
    expect((await service.settle(undefined, ok)).status).toBe(404);
  });

  it.each([500, 503, 0, Number.NaN])('releases without a receipt when upstream status is %s', async (status) => {
    const deps = makeDeps();
    const service = makeService(deps);
    await service.check(checkRequest);

    const reply = await service.settle('res_1', { status, headers: {}, body: undefined });

    expect(reply).toEqual({ status: 200, headers: {}, body: { released: true } });
    expect(deps.release).toHaveBeenCalledWith(call, expect.stringContaining('Upstream failed'));
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.issueReceipt).not.toHaveBeenCalled();
  });

  it('never charges more than the reserved upper bound', async () => {
    const deps = makeDeps({ measure: vi.fn(async () => ({ units: 5000, amount: 500, fallbackUsed: false })) });
    const service = makeService(deps);
    await service.check(checkRequest);

    await service.settle('res_1', ok);
    expect(deps.commit).toHaveBeenCalledWith(call, { units: 100, amount: 10, fallbackUsed: false });
  });

  it('charges the reservation bound when measurement throws', async () => {
    const deps = makeDeps({ measure: vi.fn(async () => { throw new Error('bad body'); }) });
    const service = makeService(deps);
    await service.check(checkRequest);

    await service.settle('res_1', ok);
    expect(deps.commit).toHaveBeenCalledWith(call, { units: 100, amount: 10, fallbackUsed: true });
  });

  it('returns 500 when commit fails', async () => {
    const deps = makeDeps({ commit: vi.fn(async () => { throw new Error('ledger down'); }) });
    const service = makeService(deps);
    await service.check(checkRequest);

    const reply = await service.settle('res_1', ok);
    expect(reply.status).toBe(500);
    expect(deps.issueReceipt).not.toHaveBeenCalled();
  });
});

describe('EnvoyExtAuthzService pending TTL', () => {
  it('releases admitted calls that never settle', async () => {
    let now = 1_000;
    const deps = makeDeps({ now: () => now });
    const service = makeService(deps, { ttl: 60_000 });
    await service.check(checkRequest);

    now += 60_001;
    service.sweepExpired();
    await Promise.resolve();

    expect(service.pendingCount()).toBe(0);
    expect(deps.release).toHaveBeenCalledWith(call, expect.stringContaining('TTL'));
    expect((await service.settle('res_1', ok200())).status).toBe(404);
  });
});

function ok200() {
  return { status: 200, headers: {}, body: undefined };
}
