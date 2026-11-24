
import { RateLimitRedisStore } from '../lib/redis-store';
import logger from '../config/logger';

export interface EndpointLatencyMetrics {
  family: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  avg_ms: number;
  sample_count: number;
}

interface LatencyStoreEntry {
  latencies: number[];
  timestamp: number;
}

export class ApiLatencyService {
  private static instance: ApiLatencyService | null = null;
  private memoryStore: Map<string, LatencyStoreEntry> = new Map();
  private readonly WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hour window
  private readonly MAX_SAMPLES_PER_FAMILY = 10000;
  private readonly REDIS_KEY_PREFIX = 'api_latency:';

  private constructor() {}

  static getInstance(): ApiLatencyService {
    if (!ApiLatencyService.instance) {
      ApiLatencyService.instance = new ApiLatencyService();
    }
    return ApiLatencyService.instance;
  }

  /**
   * Normalize a request path to an endpoint family.
   * Replaces dynamic path segments like IDs with placeholders.
   */
  getEndpointFamily(method: string, path: string): string {
    let normalizedPath = path;

    // Remove leading /api/ prefix if present
    if (normalizedPath.startsWith('/api/')) {
      normalizedPath = normalizedPath.slice(4);
    }

    // Split into segments and replace UUIDs/numbers with placeholders
    const segments = normalizedPath.split('/').map(segment => {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
        return ':id';
      }
      if (/^\d+$/.test(segment)) {
        return ':id';
      }
      return segment;
    });

    return `${method.toUpperCase()} /${segments.join('/')}`;
  }

  /**
   * Record a latency measurement for an endpoint family.
   */
  async recordLatency(family: string, latencyMs: number): Promise<void> {
    try {
      const redisStore = RateLimitRedisStore.getInstance();
      if (redisStore.isAvailable()) {
        // TODO(#698): Implement Redis-based storage once we have access to raw Redis client
        this.recordToMemory(family, latencyMs);
      } else {
        this.recordToMemory(family, latencyMs);
      }
    } catch (error) {
      logger.error('Failed to record API latency:', error);
    }
  }

  private recordToMemory(family: string, latencyMs: number): void {
    const now = Date.now();
    const entry = this.memoryStore.get(family) || { latencies: [], timestamp: now };
    
    // Clean up old entries
    if (now - entry.timestamp > this.WINDOW_MS) {
      entry.latencies = [];
      entry.timestamp = now;
    }

    // Add new latency
    entry.latencies.push(latencyMs);

    // Trim to max samples
    if (entry.latencies.length > this.MAX_SAMPLES_PER_FAMILY) {
      entry.latencies = entry.latencies.slice(-this.MAX_SAMPLES_PER_FAMILY);
    }

    this.memoryStore.set(family, entry);
  }

  /**
   * Compute percentile metrics for all endpoint families.
   */
  async getLatencyMetrics(): Promise<EndpointLatencyMetrics[]> {
    const metrics: EndpointLatencyMetrics[] = [];
    const now = Date.now();

    for (const [family, entry] of this.memoryStore.entries()) {
      // Skip if entry is too old
      if (now - entry.timestamp > this.WINDOW_MS) {
        continue;
      }

      const sorted = [...entry.latencies].sort((a, b) => a - b);
      const percentiles = this.computePercentiles(sorted);

      metrics.push({
        family,
        ...percentiles,
      });
    }

    // Sort by sample count descending
    return metrics.sort((a, b) => b.sample_count - a.sample_count);
  }

  private computePercentiles(sorted: number[]): Omit<EndpointLatencyMetrics, 'family'> {
    if (sorted.length === 0) {
      return {
        p50_ms: 0,
        p95_ms: 0,
        p99_ms: 0,
        avg_ms: 0,
        sample_count: 0,
      };
    }

    const at = (pct: number) => {
      const idx = Math.min(Math.ceil((pct / 100) * sorted.length) - 1, sorted.length - 1);
      return sorted[Math.max(0, idx)];
    };

    const avg = sorted.reduce((sum, val) => sum + val, 0) / sorted.length;

    return {
      p50_ms: at(50),
      p95_ms: at(95),
      p99_ms: at(99),
      avg_ms: Math.round(avg),
      sample_count: sorted.length,
    };
  }
}

export const apiLatencyService = ApiLatencyService.getInstance();

