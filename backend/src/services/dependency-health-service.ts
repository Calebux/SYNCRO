import { supabase } from '../config/database';
import logger from '../config/logger';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { schedulerService } from './scheduler';
import { v3NotificationDispatch } from './v3-notification-dispatch';

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

const LAST_HEALTH_STATE_KEY = 'syncro:health:last_degraded_state' as const;
const FORCED_STATES_KEY = 'syncro:health:forced_states' as const;

export interface ForcedOverride {
  forcedStatus: 'healthy' | 'degraded' | 'unhealthy';
  forcedByOperatorId: string;
  forcedAt: string;
  expiresAt: string;
}

export async function getForcedOverrides(): Promise<Map<string, ForcedOverride>> {
  const map = new Map<string, ForcedOverride>();
  if (!redis) return map;
  try {
    const raw = await redis.hGetAll(FORCED_STATES_KEY);
    const now = Date.now();
    for (const [name, json] of Object.entries(raw)) {
      try {
        const parsed = JSON.parse(json) as ForcedOverride;
        if (new Date(parsed.expiresAt).getTime() > now) {
          map.set(name, parsed);
        } else {
          await redis.hDel(FORCED_STATES_KEY, name);
        }
      } catch {
        await redis.hDel(FORCED_STATES_KEY, name);
      }
    }
  } catch (error) {
    logger.warn('[DependencyHealth] Failed to read forced overrides', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return map;
}

export async function setForcedOverride(
  provider: string,
  forcedStatus: ForcedOverride['forcedStatus'],
  operatorId: string,
  ttlHours: number
): Promise<ForcedOverride> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const override: ForcedOverride = {
    forcedStatus,
    forcedByOperatorId: operatorId,
    forcedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  if (redis) {
    try {
      await redis.hSet(FORCED_STATES_KEY, provider, JSON.stringify(override));
      await redis.expire(
        FORCED_STATES_KEY,
        Math.max(ttlHours * 60 * 60, 7 * 24 * 60 * 60)
      );
    } catch (error) {
      logger.warn('[DependencyHealth] Failed to persist forced override', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return override;
}

function applyOverrides(
  statuses: DependencyStatus[],
  overrides: Map<string, ForcedOverride>
): DependencyStatus[] {
  return statuses.map((s) => {
    const ov = overrides.get(s.name);
    if (!ov) return s;
    return {
      name: s.name,
      status: ov.forcedStatus,
      latency_ms: s.latency_ms,
      error: `FORCED_OVERRIDE_BY_OPERATOR ${ov.forcedByOperatorId} until ${ov.expiresAt}`,
    };
  });
}

function systemStateFor(dependencies: DependencyStatus[]): 'healthy' | 'degraded' {
  const anyNotHealthy = dependencies.some((d) => d.status !== 'healthy');
  return anyNotHealthy ? 'degraded' : 'healthy';
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
  * Check external providers used by the v3 runtime.
   * Note: This is a lightweight check - full validation happens at usage time
   */
  async checkProviders(): Promise<DependencyStatus> {
    const start = Date.now();
    try {
      const providers: { [key: string]: string | undefined } = {
        gmail: env.GOOGLE_CLIENT_ID,
        outlook: env.MICROSOFT_CLIENT_ID,
        telegram: env.TELEGRAM_BOT_TOKEN,
        stellar: env.STELLAR_NETWORK,
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
      const rpcUrl = env.SOROBAN_RPC_URL;

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
    const [checks, overrides] = await Promise.all([
      Promise.all([
        this.checkDatabase(),
        this.checkRedis(),
        this.checkQueue(),
        this.checkProviders(),
        this.checkRpcHorizon(),
        this.checkFxProvider(),
      ]),
      getForcedOverrides(),
    ]);

    return applyOverrides([...checks, this.checkScheduler()], overrides);
  }

  /**
   * Determine readiness based on critical dependencies.
   *
   * Critical dependencies are hard dependencies the service cannot function
   * without: `database`, `redis`, `rpc_horizon`, `fx_provider`. The service
   * only reports `ready` when every critical dependency is `healthy`; any
   * critical dependency that is `degraded` or `unhealthy` flips the service to
   * `not_ready` so the readiness probe never returns 200 for a service whose
   * hard dependencies are down.
   */
  async getReadiness(): Promise<ReadinessStatus> {
    const dependencies = await this.checkAllDependencies();
    const { status, message } = computeReadiness(dependencies);
    const timestamp = new Date().toISOString();
    const newState = systemStateFor(dependencies);

    try {
      let previousState: 'healthy' | 'degraded' = 'healthy';
      try {
        const last = redis ? await redis.get(LAST_HEALTH_STATE_KEY) : null;
        previousState = (last === 'degraded' || last === 'healthy') ? last : 'healthy';
      } catch {
        // If Redis is unavailable, fall back to assuming healthy prior state
        previousState = 'healthy';
      }

      if (previousState !== newState) {
        // Fire v3 operator alerts on state transitions only.
        const eventType = newState === 'degraded' ? 'degraded_mode_entered' : 'degraded_mode_exited';
        v3NotificationDispatch.dispatch({
          eventType,
          payload: {
            timestamp,
            dependencies: dependencies.map(({ name, status, error }) => ({ name, status, error })),
            previousState,
            newState,
          },
        }).catch((err) => {
          logger.error(`${eventType} v3 dispatch failed`, { error: err instanceof Error ? err.message : String(err) });
        });

        if (redis) {
          try {
            await redis.set(LAST_HEALTH_STATE_KEY, newState);
          } catch {
            // no-op: state persistence failure shouldn't take down readiness probe
          }
        }
      }
    } catch (err) {
      // v3 dispatch is side-channel; never fail readiness probe because of it.
      logger.warn('[DependencyHealth] v3 degraded transition dispatch skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      status,
      timestamp,
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

/**
 * Pure readiness decision: given the dependency statuses, decide whether the
 * service is ready to accept traffic.
 *
 * Readiness fails (`not_ready`) when any critical dependency is not `healthy`
 * (i.e. `degraded` or `unhealthy`). Non-critical dependencies may be degraded
 * without failing readiness.
 *
 * Critical dependencies (hard dependencies): database, redis, rpc_horizon,
 * fx_provider.
 */
export function computeReadiness(
  dependencies: DependencyStatus[],
  criticalNames: readonly string[] = ['database', 'redis', 'rpc_horizon', 'fx_provider'],
): { status: 'ready' | 'not_ready'; message: string } {
  const critical = dependencies.filter((d) => criticalNames.includes(d.name));
  const unavailable = critical.filter((d) => d.status !== 'healthy');

  if (unavailable.length > 0) {
    return {
      status: 'not_ready',
      message: `Critical dependencies unavailable: ${unavailable
        .map((d) => `${d.name} (${d.status})`)
        .join(', ')}`,
    };
  }

  const degraded = dependencies.filter((d) => d.status === 'degraded');
  if (degraded.length > 0) {
    return {
      status: 'ready',
      message: `Some dependencies degraded: ${degraded.map((d) => d.name).join(', ')}`,
    };
  }

  return { status: 'ready', message: 'All critical dependencies healthy' };
}

export const dependencyHealthService = new DependencyHealthService();
