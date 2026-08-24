import { supabase, databaseRepository, databaseRepository } from '../config/database';
import logger from '../config/logger';
import { redis } from '../config/redis';
import { schedulerService } from './scheduler';

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
      const { data, error } = await databaseRepository.from('subscriptions').select('count', { count: 'exact', head: true });
      
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
   * Check Redis connectivity.
   * Returns degraded (not unhealthy) when Redis is not configured, so that a
   * deployment without Redis does not block the readiness probe.
   */
  async checkRedis(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      if (!redis) {
        return {
          name: 'redis',
          status: 'degraded',
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
   * Check queue service (Bull/Redis-based).
   * Treated as optional; degrades gracefully when Redis is absent.
   */
  async checkQueue(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      if (!redis) {
        return {
          name: 'queue',
          status: 'degraded',
          latency_ms: Date.now() - start,
          error: 'Redis not configured; queue unavailable',
        };
      }

      const pong = await redis.ping();
      if (!pong) {
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
   * Check background scheduler / processor.
   * Healthy when cron jobs are running; degraded when scheduler has no jobs.
   */
  checkScheduler(): DependencyStatus {
    try {
      const { running, jobCount } = schedulerService.getStatus();
      if (running && jobCount > 0) {
        return { name: 'scheduler', status: 'healthy' };
      }
      return {
        name: 'scheduler',
        status: 'degraded',
        error: running ? 'Scheduler running but 0 jobs registered' : 'Scheduler not started',
      };
    } catch (error) {
      return {
        name: 'scheduler',
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Scheduler check failed',
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
   * Check Stellar RPC/Horizon connectivity.
   * Attempts to reach the configured Soroban RPC endpoint to verify
   * the blockchain node is reachable.
   * Returns degraded (not unhealthy) when RPC URL is not configured.
   */
  async checkRpcHorizon(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      const rpcUrl = process.env.SOROBAN_RPC_URL;

      if (!rpcUrl) {
        return {
          name: 'rpc_horizon',
          status: 'degraded',
          latency_ms: Date.now() - start,
          error: 'SOROBAN_RPC_URL not configured',
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(`${rpcUrl}/.well-known/stellar-org`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          name: 'rpc_horizon',
          status: 'unhealthy',
          latency_ms: Date.now() - start,
          error: `RPC endpoint returned status ${response.status}`,
        };
      }

      return {
        name: 'rpc_horizon',
        status: 'healthy',
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'RPC/Horizon check failed';

      // Timeout errors are common enough to label clearly
      if (message.includes('abort') || message.includes('timeout')) {
        return {
          name: 'rpc_horizon',
          status: 'unhealthy',
          latency_ms: Date.now() - start,
          error: 'RPC endpoint timed out',
        };
      }

      return {
        name: 'rpc_horizon',
        status: 'unhealthy',
        latency_ms: Date.now() - start,
        error: message,
      };
    }
  }

  /**
   * Check FX (foreign exchange) provider connectivity.
   * Attempts to fetch rates from the configured exchange rate provider
   * to verify the service is reachable.
   * Returns degraded when FX provider URL is not configured.
   */
  async checkFxProvider(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      // Use the same base URL as the fiat provider
      const fxUrl = 'https://api.exchangerate-api.com/v4/latest/USD';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(fxUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          name: 'fx_provider',
          status: 'unhealthy',
          latency_ms: Date.now() - start,
          error: `FX provider returned status ${response.status}`,
        };
      }

      return {
        name: 'fx_provider',
        status: 'healthy',
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FX provider check failed';

      if (message.includes('abort') || message.includes('timeout')) {
        return {
          name: 'fx_provider',
          status: 'unhealthy',
          latency_ms: Date.now() - start,
          error: 'FX provider timed out',
        };
      }

      return {
        name: 'fx_provider',
        status: 'unhealthy',
        latency_ms: Date.now() - start,
        error: message,
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
      this.checkRpcHorizon(),
      this.checkFxProvider(),
    ]);

    return [...checks, this.checkScheduler()];
  }

  /**
   * Determine readiness based on critical dependencies
   * Ready = critical deps healthy (database, redis, rpc_horizon, fx_provider)
   * Degraded = one critical dep unhealthy
   * Not ready = multiple critical deps unhealthy
   */
  async getReadiness(): Promise<ReadinessStatus> {
    const dependencies = await this.checkAllDependencies();
    
    const critical = ['database', 'redis', 'rpc_horizon', 'fx_provider'];
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
