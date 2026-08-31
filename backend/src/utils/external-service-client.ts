import logger from '../config/logger';
import { withRetry, NonRetryableError } from './retry';
import { getServicePolicy, ServicePolicy } from '../config/external-services';

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface ServiceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  timeoutRequests: number;
  retryCount: number;
}

/**
 * In-memory metrics storage for external services.
 * In a production environment, these should be exported to a metrics system (e.g., Prometheus).
 */
const metricsRegistry: Record<string, ServiceMetrics> = {};

function getOrCreateMetrics(serviceName: string): ServiceMetrics {
  if (!metricsRegistry[serviceName]) {
    metricsRegistry[serviceName] = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      retryCount: 0,
    };
  }
  return metricsRegistry[serviceName];
}

/**
 * A central client for making requests to external services with 
 * built-in timeouts, retries, and metrics tracking.
 */
export class ExternalServiceClient {
  private serviceName: string;
  private policy: ServicePolicy;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.policy = getServicePolicy(serviceName);
  }

  /**
   * Execute a request with timeout and retry logic.
   */
  async request<T>(
    url: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const metrics = getOrCreateMetrics(this.serviceName);
    metrics.totalRequests++;

    const timeoutMs = options.timeoutMs || this.policy.timeoutMs;
    const retryPolicy = this.policy.retryPolicy;
    const maxAttempts = options.maxAttempts || retryPolicy.maxAttempts;

    try {
      return await withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
          });

          if (!response) {
            throw new Error(`External service ${this.serviceName} returned no response`);
          }

          const responseOk = typeof response.ok === 'boolean' ? response.ok : true;
          const responseStatus = typeof response.status === 'number' ? response.status : 200;

          if (!responseOk) {
            let responseBody = '';
            try {
              responseBody = await response.text();
            } catch {
              responseBody = '';
            }

            const statusMessage = `External service ${this.serviceName} returned status ${responseStatus}${responseBody ? `: ${responseBody}` : ''}`;

            // Some status codes should not be retried (e.g., 400, 401, 403, 404)
            if (
              (responseStatus >= 400 && responseStatus < 500) ||
              responseBody.includes('invalid_grant') ||
              responseBody.includes('interaction_required')
            ) {
              throw new NonRetryableError(statusMessage);
            }
            throw new Error(statusMessage);
          }

          const data = await response.json() as T;
          metrics.successfulRequests++;
          return data;
        } catch (error: any) {
          if (error.name === 'AbortError') {
            metrics.timeoutRequests++;
            throw new Error(`External service ${this.serviceName} request timed out after ${timeoutMs}ms`);
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      }, {
        ...retryPolicy,
        // Hook into retry logic to track retries
        maxAttempts,
      });
    } catch (error) {
      metrics.failedRequests++;
      logger.error(`External service ${this.serviceName} failed:`, {
        url,
        error: error instanceof Error ? error.message : String(error),
        metrics: metrics,
      });
      throw error;
    }
  }

  /**
   * Static method to get metrics for all services.
   */
  static getAllMetrics(): Record<string, ServiceMetrics> {
    return { ...metricsRegistry };
  }

  /**
   * Static method to get metrics for a specific service.
   */
  static getMetrics(serviceName: string): ServiceMetrics | undefined {
    return metricsRegistry[serviceName];
  }

  /**
   * Static method to clear all metrics (useful for testing).
   */
  static clearMetrics(): void {
    for (const key in metricsRegistry) {
      delete metricsRegistry[key];
    }
  }
}
