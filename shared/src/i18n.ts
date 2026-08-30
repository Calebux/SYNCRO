/**
 * Shared locale-aware formatting helpers.
 * Used by both the client (React) and the backend (Node / email templates).
 * All formatters accept an explicit locale and timezone so they produce
 * deterministic output regardless of the runtime's ambient locale.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FormatCurrencyOptions {
  /** BCP 47 locale tag, e.g. "en-US", "de-DE", "ja-JP" */
  locale?: string;
  /** Minimum fraction digits (default: 2, 0 for JPY etc.) */
  minimumFractionDigits?: number;
  /** Maximum fraction digits (default: 2, 0 for JPY etc.) */
  maximumFractionDigits?: number;
}

export interface FormatNumberOptions {
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export interface FormatDateOptions {
  locale?: string;
  timezone?: string;
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  timeStyle?: 'full' | 'long' | 'medium' | 'short';
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_LOCALE = 'en-US';
export const DEFAULT_TIMEZONE = 'UTC';

/**
 * ISO 4217 currencies that have zero decimal places.
 * Intl.NumberFormat handles this automatically, but kept here for reference.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'BIF', 'GNF', 'MGA', 'PYG', 'RWF', 'UGX', 'XAF', 'XOF', 'XPF']);

/**
 * Non-ISO currencies used in the platform (crypto / regional).
 */
const NON_ISO_CURRENCIES = new Set(['XLM', 'USDC']);

// ─── Currency ─────────────────────────────────────────────────────────────────

/**
 * Format an amount as a locale-aware currency string.
 *
 * @example
 * formatCurrency(1234.5, 'EUR', { locale: 'de-DE' }) // "1.234,50 €"
 * formatCurrency(1234.5, 'USD', { locale: 'en-US' }) // "$1,234.50"
 * formatCurrency(100,    'XLM', { locale: 'en-US' }) // "100.00 XLM"
 */
export function formatCurrency(
  amount: number,
  currency = 'USD',
  options: FormatCurrencyOptions = {},
): string {
  const { locale = DEFAULT_LOCALE } = options;
  const code = currency.toUpperCase();

  // Crypto / non-ISO codes — format the number, append the ticker
  if (NON_ISO_CURRENCIES.has(code)) {
    const fractionDigits = options.minimumFractionDigits ?? 2;
    const num = new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: options.maximumFractionDigits ?? fractionDigits,
    }).format(amount);
    return `${num} ${code}`;
  }

  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code);
  const minFraction = options.minimumFractionDigits ?? (isZeroDecimal ? 0 : 2);
  const maxFraction = options.maximumFractionDigits ?? (isZeroDecimal ? 0 : 2);

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: minFraction,
      maximumFractionDigits: maxFraction,
    }).format(amount);
  } catch {
    // Fallback: unknown currency code — number + ticker
    const num = new Intl.NumberFormat(locale, {
      minimumFractionDigits: minFraction,
      maximumFractionDigits: maxFraction,
    }).format(amount);
    return `${num} ${code}`;
  }
}

// ─── Numbers ──────────────────────────────────────────────────────────────────

/**
 * Format a plain number with locale-aware grouping / decimal separators.
 *
 * @example
 * formatNumber(1234567.89, { locale: 'de-DE' }) // "1.234.567,89"
 * formatNumber(1234567.89, { locale: 'en-US' }) // "1,234,567.89"
 */
export function formatNumber(
  value: number,
  options: FormatNumberOptions = {},
): string {
  const { locale = DEFAULT_LOCALE, minimumFractionDigits = 0, maximumFractionDigits = 2 } = options;
  return new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }).format(value);
}

/**
 * Format a percentage value (0–100) with a locale-appropriate percent sign.
 *
 * @example
 * formatPercent(12.5, { locale: 'en-US' }) // "12.5%"
 * formatPercent(12.5, { locale: 'fr-FR' }) // "12,5 %"
 */
export function formatPercent(
  value: number,
  options: FormatNumberOptions = {},
): string {
  const { locale = DEFAULT_LOCALE, minimumFractionDigits = 1, maximumFractionDigits = 1 } = options;
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value / 100);
}

// ─── Dates ────────────────────────────────────────────────────────────────────

/**
 * Format a date value as a locale-aware date string.
 *
 * @example
 * formatDate('2025-03-01', { locale: 'en-US', dateStyle: 'long' }) // "March 1, 2025"
 * formatDate('2025-03-01', { locale: 'de-DE', dateStyle: 'long' }) // "1. März 2025"
 */
export function formatDate(
  date: Date | string | number,
  options: FormatDateOptions = {},
): string {
  const {
    locale = DEFAULT_LOCALE,
    timezone = DEFAULT_TIMEZONE,
    dateStyle = 'medium',
    timeStyle,
  } = options;

  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';

  return new Intl.DateTimeFormat(locale, {
    dateStyle,
    ...(timeStyle ? { timeStyle } : {}),
    timeZone: timezone,
  }).format(d);
}

/**
 * Format a date + time value as a locale-aware string.
 */
export function formatDateTime(
  date: Date | string | number,
  options: FormatDateOptions = {},
): string {
  return formatDate(date, { dateStyle: 'medium', timeStyle: 'short', ...options });
}

/**
 * Format only the month and day (no year) — used in renewal lists.
 *
 * @example
 * formatMonthDay('2025-03-15', { locale: 'en-US' }) // "March 15"
 * formatMonthDay('2025-03-15', { locale: 'de-DE' }) // "15. März"
 */
export function formatMonthDay(
  date: Date | string | number,
  options: Pick<FormatDateOptions, 'locale' | 'timezone'> = {},
): string {
  const { locale = DEFAULT_LOCALE, timezone = DEFAULT_TIMEZONE } = options;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';

  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  }).format(d);
}

// ─── Relative time ────────────────────────────────────────────────────────────

/**
 * Format a number of days as a relative duration string.
 *
 * @example
 * formatDaysRelative(3, { locale: 'en-US' }) // "in 3 days"
 * formatDaysRelative(0, { locale: 'en-US' }) // "today"
 */
export function formatDaysRelative(
  days: number,
  options: Pick<FormatNumberOptions, 'locale'> = {},
): string {
  const { locale = DEFAULT_LOCALE } = options;
  if (days === 0) {
    // "today" has no direct Intl API; use RelativeTimeFormat with 0 days
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'day');
  }
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(days, 'day');
}
