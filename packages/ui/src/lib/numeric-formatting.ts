/**
 * Numeric formatting conventions for the v3 console.
 *
 * This module establishes the single source of truth for displaying
 * monetary amounts, stroops, and other numeric data in the console.
 * No page should render monetary values ad-hoc — use these primitives.
 */

import { formatNumber, formatCurrency, formatPercent } from "@syncro/shared/i18n";

/**
 * Settlement asset configuration.
 * In SYNCRO v3, the settlement asset is USDC on Stellar (6 decimals).
 * Stroops are the base unit on Stellar (1 XLM = 10^7 stroops).
 * For USDC: 1 USDC = 10^6 base units (not stroops).
 */
export const SETTLEMENT_ASSET = {
  code: "USDC",
  symbol: "USDC",
  decimals: 6,
  /** Smallest displayable unit in the settlement asset (micro-USDC) */
  baseUnit: 1_000_000,
} as const;

/**
 * Stellar native asset (XLM) configuration.
 * 1 XLM = 10^7 stroops.
 */
export const STELLAR_NATIVE = {
  code: "XLM",
  symbol: "XLM",
  decimals: 7,
  stroopsPerXlm: 10_000_000,
} as const;

export type AssetConfig = typeof SETTLEMENT_ASSET | typeof STELLAR_NATIVE;

/**
 * Format a monetary amount in the settlement asset (USDC).
 * Always uses fixed precision matching the asset's decimals.
 * Never renders integer stroops/base-units as floats.
 */
export function formatSettlementAmount(
  amount: number | bigint,
  options: { locale?: string; showSymbol?: boolean } = {},
): string {
  const { locale = "en-US", showSymbol = true } = options;
  const num = typeof amount === "bigint" ? Number(amount) : amount;
  const fractionDigits = SETTLEMENT_ASSET.decimals;

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  }).format(num);

  return showSymbol ? `${formatted} ${SETTLEMENT_ASSET.symbol}` : formatted;
}

/**
 * Format a raw stroop amount (integer) as XLM.
 * Stroops are NEVER rendered as floats — always converted to XLM first.
 */
export function formatStroopsAsXlm(
  stroops: number | bigint,
  options: { locale?: string; showSymbol?: boolean } = {},
): string {
  const { locale = "en-US", showSymbol = true } = options;
  const num = typeof stroops === "bigint" ? Number(stroops) : stroops;
  const xlm = num / STELLAR_NATIVE.stroopsPerXlm;

  return formatCurrency(xlm, STELLAR_NATIVE.code, {
    locale,
    minimumFractionDigits: STELLAR_NATIVE.decimals,
    maximumFractionDigits: STELLAR_NATIVE.decimals,
  });
}

/**
 * Format a base-unit amount (integer) for any asset config.
 * Base units are NEVER rendered as floats — always converted first.
 */
export function formatBaseUnits(
  baseUnits: number | bigint,
  asset: AssetConfig,
  options: { locale?: string; showSymbol?: boolean } = {},
): string {
  const { locale = "en-US", showSymbol = true } = options;
  const num = typeof baseUnits === "bigint" ? Number(baseUnits) : baseUnits;
  const amount = num / asset.baseUnit;

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: asset.decimals,
    maximumFractionDigits: asset.decimals,
    useGrouping: true,
  }).format(amount);

  return showSymbol ? `${formatted} ${asset.symbol}` : formatted;
}

/**
 * Format a delta (change) value with sign and color coding.
 * Used for deltas in tables, sparklines, and metric cards.
 */
export interface DeltaFormatOptions {
  locale?: string;
  /** Number of decimal places (default: 2) */
  precision?: number;
  /** Show + sign for positive values (default: true) */
  showPlusSign?: boolean;
  /** Asset config for monetary deltas */
  asset?: AssetConfig;
}

/**
 * Format a numeric delta with sign.
 * Returns an object with the formatted value and a semantic class for styling.
 */
export function formatDelta(
  value: number,
  options: DeltaFormatOptions = {},
): { formatted: string; isPositive: boolean; isNegative: boolean; isZero: boolean } {
  const { locale = "en-US", precision = 2, showPlusSign = true, asset } = options;
  const isPositive = value > 0;
  const isNegative = value < 0;
  const isZero = value === 0;

  let formatted: string;
  if (asset) {
    const absValue = Math.abs(value) / asset.baseUnit;
    const numStr = new Intl.NumberFormat(locale, {
      minimumFractionDigits: asset.decimals,
      maximumFractionDigits: asset.decimals,
      useGrouping: true,
    }).format(absValue);
    formatted = `${showPlusSign && isPositive ? "+" : ""}${isNegative ? "−" : ""}${numStr} ${asset.symbol}`;
  } else {
    const numStr = new Intl.NumberFormat(locale, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
      useGrouping: true,
    }).format(Math.abs(value));
    formatted = `${showPlusSign && isPositive ? "+" : ""}${isNegative ? "−" : ""}${numStr}`;
  }

  return { formatted, isPositive, isNegative, isZero };
}

/**
 * Format a percentage delta (e.g., +5.2%, −3.1%).
 */
export function formatPercentDelta(
  value: number, // value is already a percentage (e.g., 5.2 for +5.2%)
  options: { locale?: string; precision?: number; showPlusSign?: boolean } = {},
): { formatted: string; isPositive: boolean; isNegative: boolean; isZero: boolean } {
  const { locale = "en-US", precision = 1, showPlusSign = true } = options;
  const isPositive = value > 0;
  const isNegative = value < 0;
  const isZero = value === 0;

  const numStr = new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    useGrouping: true,
  }).format(Math.abs(value));

  const formatted = `${showPlusSign && isPositive ? "+" : ""}${isNegative ? "−" : ""}${numStr}%`;

  return { formatted, isPositive, isNegative, isZero };
}

/**
 * Format a large number with compact notation (K, M, B).
 * Used for metrics like "Total Calls: 1.2M".
 */
export function formatCompactNumber(
  value: number,
  options: { locale?: string; precision?: number } = {},
): string {
  const { locale = "en-US", precision = 1 } = options;
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    compactDisplay: "short",
    minimumFractionDigits: 0,
    maximumFractionDigits: precision,
  }).format(value);
}

/**
 * Format a nonce (integer, no grouping, no decimals).
 * Nonces are always whole numbers.
 */
export function formatNonce(nonce: number | bigint): string {
  const num = typeof nonce === "bigint" ? Number(nonce) : nonce;
  return new Intl.NumberFormat("en-US", { useGrouping: false }).format(num);
}

/**
 * Format a balance with the appropriate asset config.
 * Automatically handles settlement asset vs XLM vs other.
 */
export interface BalanceFormatOptions {
  locale?: string;
  showSymbol?: boolean;
  /** If true, show zero as "—" instead of "0.00" */
  blankZero?: boolean;
}

export function formatBalance(
  amount: number | bigint,
  asset: AssetConfig = SETTLEMENT_ASSET,
  options: BalanceFormatOptions = {},
): string {
  const { locale = "en-US", showSymbol = true, blankZero = false } = options;
  const num = typeof amount === "bigint" ? Number(amount) : amount;

  if (blankZero && num === 0) {
    return "—";
  }

  return formatBaseUnits(num, asset, { locale, showSymbol });
}

/**
 * Format a rate (e.g., calls per second, cost per call).
 */
export function formatRate(
  value: number,
  unit: string,
  options: { locale?: string; precision?: number } = {},
): string {
  const { locale = "en-US", precision = 4 } = options;
  const numStr = new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    useGrouping: true,
  }).format(value);
  return `${numStr} ${unit}`;
}

/**
 * Type guard to check if a value is a valid finite number.
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Type guard for bigint.
 */
export function isBigInt(value: unknown): value is bigint {
  return typeof value === "bigint";
}

/**
 * Safely convert a numeric value (number | bigint | string) to number.
 * Returns NaN if conversion fails.
 */
export function toNumber(value: number | bigint | string | null | undefined): number {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Safely convert to bigint.
 * Returns 0n if conversion fails.
 */
export function toBigInt(value: number | bigint | string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.floor(value));
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}