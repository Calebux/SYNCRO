import { SorobanRpcPool } from '../platform/soroban-rpc-pool';

function rpcResponse(result: unknown): Response {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SorobanRpcPool', () => {
  it('fails over from an unavailable primary and alerts when only one provider remains', async () => {
    const alert = jest.fn();
    const fetcher = jest.fn(async (input: string | URL | Request) => {
      if (String(input) === 'http://primary') {
        throw new Error('connection refused');
      }
      return rpcResponse({ events: [] });
    });
    const pool = new SorobanRpcPool({
      endpoints: ['http://primary', 'http://secondary'],
      fetch: fetcher as typeof fetch,
      onSingleHealthyEndpoint: alert,
    });

    const response = await pool.fetch({
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getEvents' }),
    });

    expect(await response.json()).toEqual({ result: { events: [] } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(pool.getHealth().map(({ healthy }) => healthy)).toEqual([false, true]);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('marks a node unhealthy when its ledger is outside the configured lag tolerance', async () => {
    const fetcher = jest.fn(async (input: string | URL | Request) => (
      rpcResponse({
        sequence: String(input).includes('lagging') ? 97 : 100,
      })
    ));
    const pool = new SorobanRpcPool({
      endpoints: ['http://current', 'http://lagging'],
      maxLedgerLag: 2,
      fetch: fetcher as typeof fetch,
    });

    const health = await pool.checkLedgerAgreement();

    expect(health.map(({ healthy }) => healthy)).toEqual([true, false]);
    expect(health[1].latestLedger).toBe(97);
    expect(health[1].lastError).toContain('behind 100');
  });
});
