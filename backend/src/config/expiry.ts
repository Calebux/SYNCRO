import { env } from './env';

export interface ExpiryConfig {
  monthly: number | null;
  quarterly: number | null;
  yearly: number | null;
  warningDays: number[];
}

/**
 * Load expiry thresholds from environment variables.
 * Re-reads on each call so env changes take effect on next cron run.
 */
export function loadExpiryConfig(): ExpiryConfig {
  return {
    monthly: parseEnvInt(env.EXPIRY_DAYS_MONTHLY),
    quarterly: parseEnvInt(env.EXPIRY_DAYS_QUARTERLY),
    yearly: parseEnvInt(env.EXPIRY_DAYS_YEARLY),
    warningDays: parseWarningDays(env.EXPIRY_WARNING_DAYS),
  };
}

/**
 * Get the inactivity threshold for a given billing cycle.
 * Returns null for 'lifetime' or any unrecognized/unconfigured cycle.
 */
export function getThresholdForCycle(
  config: ExpiryConfig,
  billingCycle: string
): number | null {
  switch (billingCycle) {
    case 'monthly':
      return config.monthly;
    case 'quarterly':
      return config.quarterly;
    case 'yearly':
      return config.yearly;
    default:
      return null;
  }
}

function parseEnvInt(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1) return null;
  return num;
}

function parseWarningDays(value: string | undefined): number[] {
  if (!value || value.trim() === '') return [7, 3, 1];

  const days = value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  return days.length > 0 ? days.sort((a, b) => b - a) : [7, 3, 1];
}
