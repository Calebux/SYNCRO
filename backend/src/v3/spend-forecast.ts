/**
 * Spend forecasting (#1856).
 *
 * Computes a rolling burn rate from recent metered payments and projects how
 * long until a cap / channel balance is exhausted. Pure and dependency-free so
 * it is shared by the principal analytics API and the cap-alert job.
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Rolling window used for burn-rate calculation. */
export const DEFAULT_BURN_WINDOW_DAYS = 7;
/** Default warn-ahead window for the forecast alert. */
export const DEFAULT_FORECAST_ALERT_WINDOW_HOURS = 24;

export interface PaymentSample {
  amount: number | string | null | undefined;
  /** ISO timestamp. */
  createdAt: string;
}

export interface SpendForecast {
  /** Average spend per day over the rolling window. */
  burnRatePerDay: number;
  /** Remaining headroom the forecast was computed against. */
  remaining: number;
  /** Hours until exhaustion; null when there is no burn, 0 when already exhausted. */
  hoursToExhaustion: number | null;
  /** ISO timestamp of projected exhaustion; null when there is no burn. */
  projectedExhaustionAt: string | null;
}

/**
 * Rolling burn rate per day over the last `windowDays` ending at `nowMs`.
 *
 * Payments outside the window, in the future, or with invalid amounts/dates
 * are ignored. The window is never shortened to the age of the first payment,
 * so a brand-new burst is averaged over the whole window rather than
 * extrapolated as a huge rate.
 */
export function rollingBurnRatePerDay(
  payments: PaymentSample[],
  nowMs: number,
  windowDays: number = DEFAULT_BURN_WINDOW_DAYS,
): number {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return 0;
  const startMs = nowMs - windowDays * DAY_MS;
  let total = 0;
  for (const payment of payments) {
    const at = Date.parse(payment.createdAt);
    const amount = Number(payment.amount);
    if (!Number.isFinite(at) || !Number.isFinite(amount) || amount <= 0) continue;
    if (at < startMs || at > nowMs) continue;
    total += amount;
  }
  return total / windowDays;
}

/** Project time to exhaustion for `remaining` headroom at `burnRatePerDay`. */
export function projectExhaustion(
  remaining: number,
  burnRatePerDay: number,
  nowMs: number,
): SpendForecast {
  const safeRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
  const rate = Number.isFinite(burnRatePerDay) && burnRatePerDay > 0 ? burnRatePerDay : 0;
  if (rate === 0) {
    // Nothing is burning. Already-empty headroom is exhausted regardless.
    return safeRemaining === 0
      ? { burnRatePerDay: 0, remaining: 0, hoursToExhaustion: 0, projectedExhaustionAt: new Date(nowMs).toISOString() }
      : { burnRatePerDay: 0, remaining: safeRemaining, hoursToExhaustion: null, projectedExhaustionAt: null };
  }
  const hours = (safeRemaining / rate) * 24;
  return {
    burnRatePerDay: rate,
    remaining: safeRemaining,
    hoursToExhaustion: hours,
    projectedExhaustionAt: new Date(nowMs + hours * HOUR_MS).toISOString(),
  };
}

export function forecastFromPayments(
  remaining: number,
  payments: PaymentSample[],
  nowMs: number,
  windowDays: number = DEFAULT_BURN_WINDOW_DAYS,
): SpendForecast {
  return projectExhaustion(remaining, rollingBurnRatePerDay(payments, nowMs, windowDays), nowMs);
}

/**
 * True when exhaustion is projected inside `windowHours` (inclusive). Already
 * exhausted headroom is excluded when `excludeExhausted` is set so the
 * 100% cap alert, not the forecast, reports it.
 */
export function isExhaustionWithinWindow(
  forecast: Pick<SpendForecast, 'hoursToExhaustion'>,
  windowHours: number,
  excludeExhausted = true,
): boolean {
  const hours = forecast.hoursToExhaustion;
  if (hours === null || !Number.isFinite(windowHours) || windowHours <= 0) return false;
  if (excludeExhausted && hours === 0) return false;
  return hours <= windowHours;
}

/** Parse a configured window (hours); falls back to the default when invalid. */
export function parseForecastWindowHours(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FORECAST_ALERT_WINDOW_HOURS;
}
