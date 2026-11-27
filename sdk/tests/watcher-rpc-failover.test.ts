import { createEventListener } from '../src/event-listener.js';

describe('watcher RPC failover', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps processing Soroban events when the primary RPC is unavailable', async () => {
    const onEvent = jest.fn();
    const onError = jest.fn();
    const requestedProviders: string[] = [];

    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const provider = String(input);
      requestedProviders.push(provider);
      if (provider === 'http://primary-rpc') {
        throw new Error('primary RPC stopped');
      }

      const request = JSON.parse(String(init?.body)) as { method: string };
      const result = request.method === 'getLatestLedger'
        ? { sequence: 5 }
        : {
            events: [{
              type: 'RenewalSuccess',
              ledger: 5,
              txHash: 'tx-secondary',
              contractId: 'cid',
              topics: [],
              value: { sub_id: 1 },
            }],
          };
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const listener = createEventListener(
      {
        rpcUrl: 'http://primary-rpc',
        rpcUrls: ['http://primary-rpc', 'http://secondary-rpc'],
        contractIds: ['cid'],
        pollIntervalMs: 20,
        healthCheckIntervalMs: 0,
      },
      onEvent,
      onError,
    );

    await new Promise((resolve) => setTimeout(resolve, 80));
    listener.stop();

    expect(requestedProviders).toContain('http://primary-rpc');
    expect(requestedProviders).toContain('http://secondary-rpc');
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'renewalAttempt' }),
    );
    expect(onError).not.toHaveBeenCalled();
  });
});
