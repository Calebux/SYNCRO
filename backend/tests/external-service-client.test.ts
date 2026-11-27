import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
  test,
} from '@jest/globals';

// Mock logger
jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { ExternalServiceClient } from '../src/utils/external-service-client';
import { EXTERNAL_SERVICE_POLICIES } from '../src/config/external-services';

// Mock fetch
global.fetch = jest.fn();

describe('ExternalServiceClient', () => {
  const serviceName = 'exchange_rates';
  const policy = EXTERNAL_SERVICE_POLICIES[serviceName];
  let client: ExternalServiceClient;

  beforeEach(() => {
    client = new ExternalServiceClient(serviceName);
    ExternalServiceClient.clearMetrics();
    jest.clearAllMocks();
  });

  it('should successfully make a request', async () => {
    const mockData = { rates: { USD: 1 } };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    });

    const result = await client.request('https://api.test.com');
    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const metrics = ExternalServiceClient.getMetrics(serviceName);
    expect(metrics?.successfulRequests).toBe(1);
    expect(metrics?.totalRequests).toBe(1);
  });

  it('should retry on failure', async () => {
    const mockData = { rates: { USD: 1 } };
    
    // Fail twice, then succeed
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      });

    const result = await client.request('https://api.test.com');
    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    const metrics = ExternalServiceClient.getMetrics(serviceName);
    expect(metrics?.successfulRequests).toBe(1);
  });

  it('should not retry on non-retryable error (4xx)', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
    });

    await expect(client.request('https://api.test.com')).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const metrics = ExternalServiceClient.getMetrics(serviceName);
    expect(metrics?.failedRequests).toBe(1);
  });

  it('should timeout if request takes too long', async () => {
    // We mock fetch to throw AbortError when the signal is aborted
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      return new Promise((_, reject) => {
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const fastClient = new ExternalServiceClient(serviceName);
    
    // Use a very short timeout
    const requestPromise = fastClient.request('https://api.test.com', { timeoutMs: 10 });
    
    await expect(requestPromise).rejects.toThrow(/timed out/);
    
    const metrics = ExternalServiceClient.getMetrics(serviceName);
    expect(metrics?.timeoutRequests).toBeGreaterThanOrEqual(1);
  });
});
