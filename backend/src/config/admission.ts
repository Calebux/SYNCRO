import logger from './logger';
import { env } from './env';

/**
 * Admission configuration for x402 payment verification.
 * This controls the latency budget, caching strategy, and parallelization of admission checks.
 */

export interface AdmissionBudgetConfig {
  /** Total admission budget in milliseconds (p99 target) */
  totalBudgetMs: number;
  /** Per-step budget allocations (must sum to <= totalBudgetMs) */
  stepBudgets: {
    identityResolutionMs: number;
    scopeReadMs: number;
    capCheckMs: number;
    meterReserveMs: number;
  };
  /** Whether to enable p99 tracking and CI gating */
  enableBudgetEnforcement: boolean;
  /** Window for p99 calculation in milliseconds */
  p99WindowMs: number;
  /** Minimum samples required before p99 is meaningful */
  minSamplesForP99: number;
}

export interface AdmissionCacheConfig {
  /** Enable caching for identity resolution (key resolution) */
  identityResolution: {
    enabled: boolean;
    ttlMs: number;
    maxEntries: number;
  };
  /** Enable caching for registry scope reads */
  scopeRead: {
    enabled: boolean;
    ttlMs: number;
    maxEntries: number;
  };
  /** Enable caching for cap ceiling checks */
  capCheck: {
    enabled: boolean;
    ttlMs: number;
    maxEntries: number;
  };
  /** Enable caching for meter reserve (typically short TTL) */
  meterReserve: {
    enabled: boolean;
    ttlMs: number;
    maxEntries: number;
  };
}

export interface AdmissionConfig {
  budget: AdmissionBudgetConfig;
  cache: AdmissionCacheConfig;
  /** Enable parallel execution of independent checks */
  parallelChecks: boolean;
  /** Revocation check interval in milliseconds */
  revocationCheckIntervalMs: number;
  /** Redis key prefix for admission caches */
  redisKeyPrefix: string;
}

/**
 * Parse environment variable as integer with fallback
 */
function parseIntEnv(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const parsed = parseInt(envVar, 10);
  if (isNaN(parsed) || parsed <= 0) {
    logger.warn(`Invalid admission config: ${envVar} is not a valid positive integer, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse environment variable as boolean with fallback
 */
function parseBooleanEnv(envVar: string | undefined, defaultValue: boolean): boolean {
  if (!envVar) return defaultValue;
  const lower = envVar.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  logger.warn(`Invalid boolean admission config: ${envVar}, using default: ${defaultValue}`);
  return defaultValue;
}

/**
 * Load and validate admission configuration from environment variables
 */
export function loadAdmissionConfig(): AdmissionConfig {
  // Budget configuration
  const totalBudgetMs = parseIntEnv(env.ADMISSION_TOTAL_BUDGET_MS, 50); // 50ms p99 budget
  const identityResolutionMs = parseIntEnv(env.ADMISSION_IDENTITY_RESOLUTION_MS, 10);
  const scopeReadMs = parseIntEnv(env.ADMISSION_SCOPE_READ_MS, 10);
  const capCheckMs = parseIntEnv(env.ADMISSION_CAP_CHECK_MS, 10);
  const meterReserveMs = parseIntEnv(env.ADMISSION_METER_RESERVE_MS, 10);

  const stepBudgetsSum = identityResolutionMs + scopeReadMs + capCheckMs + meterReserveMs;
  if (stepBudgetsSum > totalBudgetMs) {
    logger.warn(
      `Admission step budgets sum (${stepBudgetsMs}) exceeds total budget (${totalBudgetMs}ms). ` +
      `Consider increasing ADMISSION_TOTAL_BUDGET_MS or reducing step budgets.`
    );
  }

  const enableBudgetEnforcement = parseBooleanEnv(env.ADMISSION_BUDGET_ENFORCEMENT, true);
  const p99WindowMs = parseIntEnv(env.ADMISSION_P99_WINDOW_MS, 5 * 60 * 1000); // 5 minutes
  const minSamplesForP99 = parseIntEnv(env.ADMISSION_MIN_SAMPLES_P99, 100);

  // Cache configuration
  const identityCacheEnabled = parseBooleanEnv(env.ADMISSION_IDENTITY_CACHE_ENABLED, true);
  const identityCacheTtlMs = parseIntEnv(env.ADMISSION_IDENTITY_CACHE_TTL_MS, 60 * 1000); // 1 minute
  const identityCacheMaxEntries = parseIntEnv(env.ADMISSION_IDENTITY_CACHE_MAX_ENTRIES, 10000);

  const scopeCacheEnabled = parseBooleanEnv(env.ADMISSION_SCOPE_CACHE_ENABLED, true);
  const scopeCacheTtlMs = parseIntEnv(env.ADMISSION_SCOPE_CACHE_TTL_MS, 30 * 1000); // 30 seconds
  const scopeCacheMaxEntries = parseIntEnv(env.ADMISSION_SCOPE_CACHE_MAX_ENTRIES, 5000);

  const capCacheEnabled = parseBooleanEnv(env.ADMISSION_CAP_CACHE_ENABLED, true);
  const capCacheTtlMs = parseIntEnv(env.ADMISSION_CAP_CACHE_TTL_MS, 60 * 1000); // 1 minute
  const capCacheMaxEntries = parseIntEnv(env.ADMISSION_CAP_CACHE_MAX_ENTRIES, 5000);

  const meterCacheEnabled = parseBooleanEnv(env.ADMISSION_METER_CACHE_ENABLED, true);
  const meterCacheTtlMs = parseIntEnv(env.ADMISSION_METER_CACHE_TTL_MS, 10 * 1000); // 10 seconds
  const meterCacheMaxEntries = parseIntEnv(env.ADMISSION_METER_CACHE_MAX_ENTRIES, 2000);

  const parallelChecks = parseBooleanEnv(env.ADMISSION_PARALLEL_CHECKS, true);
  const revocationCheckIntervalMs = parseIntEnv(env.ADMISSION_REVOCATION_CHECK_INTERVAL_MS, 5000); // 5 seconds
  const redisKeyPrefix = env.ADMISSION_REDIS_KEY_PREFIX || 'admission:';

  const config: AdmissionConfig = {
    budget: {
      totalBudgetMs,
      stepBudgets: {
        identityResolutionMs,
        scopeReadMs,
        capCheckMs,
        meterReserveMs,
      },
      enableBudgetEnforcement,
      p99WindowMs,
      minSamplesForP99,
    },
    cache: {
      identityResolution: {
        enabled: identityCacheEnabled,
        ttlMs: identityCacheTtlMs,
        maxEntries: identityCacheMaxEntries,
      },
      scopeRead: {
        enabled: scopeCacheEnabled,
        ttlMs: scopeCacheTtlMs,
        maxEntries: scopeCacheMaxEntries,
      },
      capCheck: {
        enabled: capCacheEnabled,
        ttlMs: capCacheTtlMs,
        maxEntries: capCacheMaxEntries,
      },
      meterReserve: {
        enabled: meterCacheEnabled,
        ttlMs: meterCacheTtlMs,
        maxEntries: meterCacheMaxEntries,
      },
    },
    parallelChecks,
    revocationCheckIntervalMs,
    redisKeyPrefix,
  };

  // Log configuration for operational visibility
  logger.info('Admission configuration loaded', {
    budget: {
      totalBudgetMs: config.budget.totalBudgetMs,
      stepBudgets: config.budget.stepBudgets,
      enableBudgetEnforcement: config.budget.enableBudgetEnforcement,
      p99WindowMs: config.budget.p99WindowMs,
      minSamplesForP99: config.budget.minSamplesForP99,
    },
    cache: config.cache,
    parallelChecks: config.parallelChecks,
    revocationCheckIntervalMs: config.revocationCheckIntervalMs,
    redisKeyPrefix: config.redisKeyPrefix,
  });

  return config;
}

// Export singleton configuration
export const admissionConfig = loadAdmissionConfig();

// Re-export types
export type { AdmissionBudgetConfig, AdmissionCacheConfig, AdmissionConfig };