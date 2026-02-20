/**
 * Tests for SyncroSDK.cancelSubscription() and the standalone cancelSubscription() helper.
 *
 * Uses Node.js built-in fetch mock (globalThis.fetch) so no extra deps are needed.
 */

import { SyncroSDK, cancelSubscription } from '../src/index';
import type { CancellationStatus } from '../src/types';

// ── Helpers ─────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.syncro.test';
const API_KEY  = 'test-api-key';
const SUB_ID   = 'sub-abc-123';

function makeSdk(): SyncroSDK {
  return new SyncroSDK({ baseUrl: BASE_URL, apiKey: API_KEY });
}

function mockFetch(status: number, body: Record<string, unknown>): void {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response);
}

// ──────────────────────────────────────────────────────────────────────────────

describe('SyncroSDK.cancelSubscription()', () => {

  afterEach(() => jest.resetAllMocks());

  // ── Constructor validation ────────────────────────────────────────────────

  it('throws when baseUrl is not provided', () => {
    expect(() => new SyncroSDK({ baseUrl: '', apiKey: API_KEY }))
      .toThrow('baseUrl is required');
  });

  it('throws when apiKey is not provided', () => {
    expect(() => new SyncroSDK({ baseUrl: BASE_URL, apiKey: '' }))
      .toThrow('apiKey is required');
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it('returns CancellationStatus with success=true on HTTP 200', async () => {
    mockFetch(200, {
      success: true,
      data: { id: SUB_ID, status: 'cancelled' },
      cancellationUrl: 'https://merchant.com/cancel',
      blockchain: { synced: true, transactionHash: 'cx_mock_hash' },
    });

    const sdk = makeSdk();
    const result = await sdk.cancelSubscription({
      subscriptionId: SUB_ID,
      cancellationUrl: 'https://merchant.com/cancel',
      reason: 'Too expensive',
    });

    expect(result.success).toBe(true);
    expect(result.subscriptionId).toBe(SUB_ID);
    expect(result.status).toBe('cancelled');
    expect(result.cancellationUrl).toBe('https://merchant.com/cancel');
    expect(result.blockchain.synced).toBe(true);
    expect(result.blockchain.transactionHash).toBe('cx_mock_hash');
  });

  it('sends correct Authorization header and JSON body', async () => {
    mockFetch(200, { success: true, data: { status: 'cancelled' }, blockchain: { synced: true } });

    const sdk = makeSdk();
    await sdk.cancelSubscription({ subscriptionId: SUB_ID, reason: 'Test' });

    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/subscriptions/${SUB_ID}/cancel`);
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(init.body)).toEqual({ reason: 'Test' });
  });

  it('includes cancellation_url in request body when provided', async () => {
    mockFetch(200, { success: true, data: { status: 'cancelled' }, blockchain: { synced: true } });

    const sdk = makeSdk();
    await sdk.cancelSubscription({
      subscriptionId: SUB_ID,
      cancellationUrl: 'https://example.com/cancel',
    });

    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ cancellation_url: 'https://example.com/cancel' });
  });

  // ── Failure paths ─────────────────────────────────────────────────────────

  it('returns success=false on HTTP 404 (not found)', async () => {
    mockFetch(404, { error: 'Subscription not found or access denied' });

    const sdk = makeSdk();
    const result = await sdk.cancelSubscription({ subscriptionId: 'bad-id' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Subscription not found or access denied');
    expect(result.blockchain.synced).toBe(false);
  });

  it('returns success=false on HTTP 409 (already cancelled)', async () => {
    mockFetch(409, { error: 'Subscription is already cancelled' });

    const sdk = makeSdk();
    const result = await sdk.cancelSubscription({ subscriptionId: SUB_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Subscription is already cancelled');
  });

  it('returns success=false and error message on network failure', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const sdk = makeSdk();
    const result = await sdk.cancelSubscription({ subscriptionId: SUB_ID });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  it('returns success=false when subscriptionId is not provided', async () => {
    // Give fetch a clean mock so we can assert it wasn't called
    globalThis.fetch = jest.fn();

    const sdk = makeSdk();
    const result = await sdk.cancelSubscription({ subscriptionId: '' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('subscriptionId is required');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ── Event emission ────────────────────────────────────────────────────────

  it('emits cancellation:success event on success', async () => {
    mockFetch(200, { success: true, data: { status: 'cancelled' }, blockchain: { synced: true } });

    const sdk = makeSdk();
    const successListener = jest.fn();
    sdk.on('cancellation:success', successListener);

    await sdk.cancelSubscription({ subscriptionId: SUB_ID });

    expect(successListener).toHaveBeenCalledTimes(1);
    const emittedStatus: CancellationStatus = successListener.mock.calls[0][0];
    expect(emittedStatus.success).toBe(true);
  });

  it('emits cancellation:failure event on HTTP error', async () => {
    mockFetch(500, { error: 'Internal server error' });

    const sdk = makeSdk();
    const failureListener = jest.fn();
    sdk.on('cancellation:failure', failureListener);

    await sdk.cancelSubscription({ subscriptionId: SUB_ID });

    expect(failureListener).toHaveBeenCalledTimes(1);
    const emittedStatus: CancellationStatus = failureListener.mock.calls[0][0];
    expect(emittedStatus.success).toBe(false);
  });

  it('emits cancellation:failure event on network error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    const sdk = makeSdk();
    const failureListener = jest.fn();
    sdk.on('cancellation:failure', failureListener);

    await sdk.cancelSubscription({ subscriptionId: SUB_ID });

    expect(failureListener).toHaveBeenCalledTimes(1);
    expect(failureListener.mock.calls[0][0].error).toContain('timeout');
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('Standalone cancelSubscription() helper', () => {
  afterEach(() => jest.resetAllMocks());

  it('delegates to SyncroSDK and returns CancellationStatus', async () => {
    mockFetch(200, {
      success: true,
      data: { id: SUB_ID, status: 'cancelled' },
      blockchain: { synced: true, transactionHash: 'cx_standalone' },
    });

    const result = await cancelSubscription({
      subscriptionId: SUB_ID,
      baseUrl: BASE_URL,
      apiKey: API_KEY,
    });

    expect(result.success).toBe(true);
    expect(result.blockchain.transactionHash).toBe('cx_standalone');
  });

  it('reads baseUrl and apiKey from env vars when not provided in options', async () => {
    process.env['SYNCRO_BASE_URL'] = BASE_URL;
    process.env['SYNCRO_API_KEY']  = API_KEY;

    mockFetch(200, {
      success: true,
      data: { status: 'cancelled' },
      blockchain: { synced: true },
    });

    const result = await cancelSubscription({ subscriptionId: SUB_ID });
    expect(result.success).toBe(true);

    delete process.env['SYNCRO_BASE_URL'];
    delete process.env['SYNCRO_API_KEY'];
  });
});
