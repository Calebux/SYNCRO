import { RpcClient } from '../../shared/src/rpc-client';

describe('RpcClient', () => {
  let client: RpcClient;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    client = new RpcClient({
      maxRetries: 2,
      baseRetryDelayMs: 10,
      timeoutMs: 100,
      circuitBreakerThreshold: 3,
      circuitBreakerResetTimeoutMs: 200,
    });

    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should succeed on first try and update metrics', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await client.fetch('http://localhost');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const metrics = client.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.successfulRequests).toBe(1);
    expect(metrics.failedRequests).toBe(0);
  });

  it('should retry on failure and eventually succeed', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true });

    await client.fetch('http://localhost');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const metrics = client.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.failedRequests).toBe(1);
    expect(metrics.successfulRequests).toBe(1);
  });

  it('should throw if max retries exceeded', async () => {
    fetchMock.mockRejectedValue(new Error('Persistent error'));

    await expect(client.fetch('http://localhost')).rejects.toThrow('Persistent error');
    
    // 1 initial + 2 retries = 3 total attempts
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const metrics = client.getMetrics();
    expect(metrics.failedRequests).toBe(3);
  });

  it('should open circuit breaker after consecutive failures', async () => {
    fetchMock.mockRejectedValue(new Error('Persistent error'));

    // 1st request -> fails 3 times (1 try + 2 retries) -> circuit opens
    await expect(client.fetch('http://localhost')).rejects.toThrow('Persistent error');

    expect(client.getMetrics().circuitState).toBe('OPEN');

    // 2nd request -> fails immediately without calling fetch
    fetchMock.mockClear();
    await expect(client.fetch('http://localhost')).rejects.toThrow('Circuit breaker is OPEN. Fast failing request.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.getMetrics().failedRequests).toBe(4);
  });

  it('should transition to HALF_OPEN after reset timeout', async () => {
    fetchMock.mockRejectedValue(new Error('Error'));

    // Open circuit
    await expect(client.fetch('http://localhost')).rejects.toThrow('Error');
    expect(client.getMetrics().circuitState).toBe('OPEN');

    // Wait for reset timeout using real timer
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(client.getMetrics().circuitState).toBe('HALF_OPEN');

    // Next request should be allowed through
    fetchMock.mockResolvedValueOnce({ ok: true });
    await client.fetch('http://localhost');

    // Circuit should close again
    expect(client.getMetrics().circuitState).toBe('CLOSED');
  });
});
