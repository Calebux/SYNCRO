import { describe, it, expect, afterEach, vi } from 'vitest';
import { getChannelHistory } from '@/lib/payment-channel';

describe('getChannelHistory', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches the channel history endpoint and returns the JSON payload', async () => {
    const payload = {
      channel: null,
      events: [],
      financials: {},
      challenge: {},
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    }) as unknown as typeof fetch;

    await expect(getChannelHistory('chan-1')).resolves.toEqual(payload);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/payment-channels/chan-1/history',
      { credentials: 'include' },
    );
  });

  it('throws when the endpoint returns an error status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    await expect(getChannelHistory('chan-1')).rejects.toThrow('Failed to fetch channel history');
  });
});