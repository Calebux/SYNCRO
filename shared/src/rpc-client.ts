export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface RpcConfig {
  maxRetries?: number;
  baseRetryDelayMs?: number;
  timeoutMs?: number;
  circuitBreakerThreshold?: number; // Number of consecutive failures to open circuit
  circuitBreakerResetTimeoutMs?: number; // Time before attempting to close circuit
}

export interface RpcMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  timeoutRequests: number;
  circuitOpenCount: number;
  circuitState: CircuitState;
}

export class RpcClient {
  private config: Required<RpcConfig>;
  private metrics: RpcMetrics;
  private consecutiveFailures: number = 0;
  private circuitState: CircuitState = 'CLOSED';
  private nextAttemptMs: number = 0;

  constructor(config: RpcConfig = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      baseRetryDelayMs: config.baseRetryDelayMs ?? 1000,
      timeoutMs: config.timeoutMs ?? 10000,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      circuitBreakerResetTimeoutMs: config.circuitBreakerResetTimeoutMs ?? 30000,
    };

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      circuitOpenCount: 0,
      circuitState: 'CLOSED',
    };
  }

  public getMetrics(): RpcMetrics {
    // Update current state for metrics accuracy
    if (this.circuitState === 'OPEN' && Date.now() >= this.nextAttemptMs) {
      this.circuitState = 'HALF_OPEN';
      this.metrics.circuitState = 'HALF_OPEN';
    }
    return { ...this.metrics };
  }

  private handleSuccess() {
    this.consecutiveFailures = 0;
    if (this.circuitState === 'HALF_OPEN' || this.circuitState === 'OPEN') {
      this.circuitState = 'CLOSED';
      this.metrics.circuitState = 'CLOSED';
    }
    this.metrics.successfulRequests++;
  }

  private handleFailure(error: any) {
    this.consecutiveFailures++;
    this.metrics.failedRequests++;

    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      this.metrics.timeoutRequests++;
    }

    if (this.circuitState === 'CLOSED' && this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.openCircuit();
    } else if (this.circuitState === 'HALF_OPEN') {
      // Failed during half-open, immediately re-open circuit
      this.openCircuit();
    }
  }

  private openCircuit() {
    this.circuitState = 'OPEN';
    this.metrics.circuitState = 'OPEN';
    this.metrics.circuitOpenCount++;
    this.nextAttemptMs = Date.now() + this.config.circuitBreakerResetTimeoutMs;
  }

  private checkCircuitBreaker(): void {
    if (this.circuitState === 'OPEN') {
      if (Date.now() >= this.nextAttemptMs) {
        this.circuitState = 'HALF_OPEN';
        this.metrics.circuitState = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN. Fast failing request.');
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public async fetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
    this.metrics.totalRequests++;

    let lastErr: any;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.checkCircuitBreaker();

        const controller = new AbortController();
        let timeoutId: any;

        if (init?.signal) {
          init.signal.addEventListener('abort', () => controller.abort());
        }

        const fetchPromise = fetch(url, {
          ...init,
          signal: controller.signal,
        });

        const timeoutPromise = new Promise<Response>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            const err = new Error('Request Timeout');
            err.name = 'TimeoutError';
            reject(err);
          }, this.config.timeoutMs);
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        this.handleSuccess();
        return response;
      } catch (err: any) {
        lastErr = err;
        
        // Fast fail if circuit breaker opens during this specific request's retry loop
        if (err.message === 'Circuit breaker is OPEN. Fast failing request.') {
          this.metrics.failedRequests++;
          throw err;
        }

        this.handleFailure(err);

        // Don't sleep on the last attempt
        if (attempt < this.config.maxRetries) {
          const delay = this.config.baseRetryDelayMs * Math.pow(2, attempt) * (0.8 + Math.random() * 0.4);
          await this.sleep(delay);
        }
      }
    }

    throw lastErr;
  }
}
