import { supabase } from '../config/database';
import logger from '../config/logger';
import { redis } from '../config/redis';

export interface DependencyStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency_ms?: number;
  error?: string;
}

export interface ReadinessStatus {
  status: 'ready' | 'not_ready';
  timestamp: string;
  dependencies: DependencyStatus[];
  message: string;
}

export interface LivenessStatus {
  status: 'alive' | 'dead';
  timestamp: string;
  uptime_ms: number;
}

export class DependencyHealthService {
  private startTime = Date.now();

  /**
   * Check database connectivity
   */
  async checkDatabase(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      const { data, error } = await supabase.from('subscriptions').select('count', { count: 'exact', head: true });
      
      if (error) {
        return {
          name: 'database',
          status: 'unhealthy',
          latency_ms: Date.now() - start,
          error: error.message,
        };
      }

      return {
        name: 'database',
        status: 'healthy',
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'unhealthy',
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check Redis connectivity
   */
  async checkRedis(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      if (!redis) {
        return {
          name: 'redis',
          status: 'unhealthy',
          latency_ms: Date.now() - start,
          error: 'Redis not configured',
        };
      }

      await redis.ping();
      return {
        name: 'redis',
        status: 'healthy',
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'redis',
        status: 'unhealthy',
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : 'Ping failed',
      };
    }
  }

  /**
   * Check queue service (Bull/Redis-based)
   */
  async checkQueue(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      // Try to connect to queue via Redis
      const queueHealth = await redis?.ping();
      
      if (!queueHealth) {
        return {
          name: 'queue',
          status: 'unhealthy',
          latency_ms: Date.now() - start,
          error: 'Queue service unreachable',
        };
      }

      return {
        name: 'queue',
        status: 'healthy',
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'queue',
        status: 'unhealthy',
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : 'Queue check failed',
      };
    }
  }

  /**
   * Check external providers (Stripe, Gmail, Outlook, etc.)
   * Note: This is a lightweight check - full validation happens at usage time
   */
  async checkProviders(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      const providers: { [key: string]: string | undefined } = {
        stripe: process.env.STRIPE_SECRET_KEY,
        gmail: process.env.GMAIL_CLIENT_ID,
        outlook: process.env.OUTLOOK_CLIENT_ID,
        telegram: process.env.TELEGRAM_BOT_TOKEN,
        stellar: process.env.STELLAR_NETWORK,
      };

      const configured = Object.entries(providers)
        .filter(([, key]) => !!key)
        .map(([name]) => name);

      const unconfigured = Object.entries(providers)
        .filter(([, key]) => !key)
        .map(([name]) => name);

      if (configured.length === 0) {
        return {
          name: 'providers',
          status: 'unhealthy',
          latency_ms: Date.now() - start,
          error: 'No external providers configured',
        };
      }

      const status = unconfigured.length > 0 ? 'degraded' : 'healthy';
      return {
        name: 'providers',
        status,
        latency_ms: Date.now() - start,
        error: unconfigured.length > 0 ? `Missing: ${unconfigured.join(', ')}` : undefined,
      };
    } catch (error) {
      return {
        name: 'providers',
        status: 'unhealthy',
        latency_ms: Date.now() - start,
        error: error instanceof Error ? error.message : 'Provider check failed',
      };
    }
  }

  /**
   * Check all dependencies
   */
  async checkAllDependencies(): Promise<DependencyStatus[]> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQueue(),
      this.checkProviders(),
    ]);

    return checks;
  }

  /**
   * Determine readiness based on critical dependencies
   * Ready = database + Redis healthy
   * Degraded = one critical dep unhealthy
   * Not ready = multiple critical deps unhealthy
   */
  async getReadiness(): Promise<ReadinessStatus> {
    const dependencies = await this.checkAllDependencies();
    
    const critical = ['database', 'redis'];
    const criticalChecks = dependencies.filter(d => critical.includes(d.name));
    const unhealthy = criticalChecks.filter(d => d.status === 'unhealthy');

    let status: 'ready' | 'not_ready' = 'ready';
    let message = 'All critical dependencies healthy';

    if (unhealthy.length > 0) {
      status = 'not_ready';
      message = `Critical dependencies unhealthy: ${unhealthy.map(d => d.name).join(', ')}`;
    } else {
      const degraded = dependencies.filter(d => d.status === 'degraded');
      if (degraded.length > 0) {
        message = `Some dependencies degraded: ${degraded.map(d => d.name).join(', ')}`;
      }
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      dependencies,
      message,
    };
  }

  /**
   * Check liveness - is the server running?
   * This is a minimal check - just verify the process is alive
   */
  getLiveness(): LivenessStatus {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime_ms: Date.now() - this.startTime,
    };
  }
}

export const dependencyHealthService = new DependencyHealthService();
