"use client";

/**
 * NumericDisplay – primitive components for consistent numeric formatting.
 *
 * These components enforce the v3 console's numeric conventions:
 * - Settlement asset amounts with fixed precision
 * - Stroops/base-units never rendered as raw floats
 * - Deltas with semantic coloring
 * - Compact numbers for large values
 * - Nonces as plain integers
 *
 * No page should render monetary values ad-hoc — use these primitives.
 */

import * as React from "react";
import { cn } from "../lib/cn";
import {
  formatSettlementAmount,
  formatStroopsAsXlm,
  formatBaseUnits,
  formatBalance,
  formatCompactNumber,
  formatNonce,
  formatRate,
  formatDelta,
  formatPercentDelta,
  type AssetConfig,
  type DeltaFormatOptions,
  type BalanceFormatOptions,
  SETTLEMENT_ASSET,
  STELLAR_NATIVE,
} from "../lib/numeric-formatting";
import { DeltaIndicator } from "./delta-indicator";
import { Sparkline } from "./sparkline";

/**
 * Amount – displays a monetary amount in the settlement asset (USDC).
 * Enforces fixed precision (6 decimals for USDC).
 */
interface AmountProps {
  /** Amount in base units (micro-USDC) */
  value: number | bigint;
  /** Asset config (default: settlement asset USDC) */
  asset?: AssetConfig;
  /** Show currency symbol (default: true) */
  showSymbol?: boolean;
  /** Locale (default: en-US) */
  locale?: string;
  /** Custom className */
  className?: string;
  /** Blank zero values (show "—" instead of "0.00") */
  blankZero?: boolean;
  /** Font size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Font weight */
  weight?: "normal" | "medium" | "semibold" | "bold";
  /** Text alignment */
  align?: "left" | "center" | "right";
}

function Amount({
  value,
  asset = SETTLEMENT_ASSET,
  showSymbol = true,
  locale = "en-US",
  className,
  blankZero = false,
  size = "md",
  weight = "normal",
  align = "right",
}: AmountProps) {
  const num = typeof value === "bigint" ? Number(value) : value;
  const isZero = num === 0;

  const formatted = blankZero && isZero
    ? "—"
    : formatBaseUnits(value, asset, { locale, showSymbol });

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl",
  };

  const weightClasses = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
  };

  const alignClasses = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  };

  return (
    <span
      className={cn(
        "font-mono tabular-nums inline-block",
        sizeClasses[size],
        weightClasses[weight],
        alignClasses[align],
        isZero && blankZero && "text-muted-foreground",
        className
      )}
      data-testid="amount"
    >
      {formatted}
    </span>
  );
}

Amount.displayName = "Amount";

/**
 * StroopsAmount – displays a stroop amount as XLM.
 * Stroops are NEVER rendered as raw floats.
 */
interface StroopsAmountProps {
  /** Amount in stroops (1 XLM = 10^7 stroops) */
  value: number | bigint;
  /** Show XLM symbol (default: true) */
  showSymbol?: boolean;
  /** Locale (default: en-US) */
  locale?: string;
  /** Custom className */
  className?: string;
  /** Blank zero values */
  blankZero?: boolean;
  /** Font size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Font weight */
  weight?: "normal" | "medium" | "semibold" | "bold";
  /** Text alignment */
  align?: "left" | "center" | "right";
}

function StroopsAmount({
  value,
  showSymbol = true,
  locale = "en-US",
  className,
  blankZero = false,
  size = "md",
  weight = "normal",
  align = "right",
}: StroopsAmountProps) {
  const num = typeof value === "bigint" ? Number(value) : value;
  const isZero = num === 0;

  const formatted = blankZero && isZero
    ? "—"
    : formatStroopsAsXlm(value, { locale, showSymbol });

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl",
  };

  const weightClasses = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
  };

  const alignClasses = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  };

  return (
    <span
      className={cn(
        "font-mono tabular-nums inline-block",
        sizeClasses[size],
        weightClasses[weight],
        alignClasses[align],
        isZero && blankZero && "text-muted-foreground",
        className
      )}
      data-testid="stroops-amount"
    >
      {formatted}
    </span>
  );
}

StroopsAmount.displayName = "StroopsAmount";

/**
 * Balance – displays a balance with appropriate formatting.
 * Supports blankZero for "—" instead of zero.
 */
interface BalanceProps extends BalanceFormatOptions {
  /** Balance in base units */
  value: number | bigint;
  /** Asset config (default: settlement asset) */
  asset?: AssetConfig;
  /** Custom className */
  className?: string;
  /** Font size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Font weight */
  weight?: "normal" | "medium" | "semibold" | "bold";
  /** Text alignment */
  align?: "left" | "center" | "right";
}

function Balance({
  value,
  asset = SETTLEMENT_ASSET,
  className,
  blankZero = false,
  size = "md",
  weight = "normal",
  align = "right",
  ...props
}: BalanceProps) {
  const num = typeof value === "bigint" ? Number(value) : value;
  const isZero = num === 0;

  const formatted = formatBalance(value, asset, { blankZero, ...props });

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl",
  };

  const weightClasses = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
  };

  const alignClasses = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  };

  return (
    <span
      className={cn(
        "font-mono tabular-nums inline-block",
        sizeClasses[size],
        weightClasses[weight],
        alignClasses[align],
        isZero && blankZero && "text-muted-foreground",
        className
      )}
      data-testid="balance"
    >
      {formatted}
    </span>
  );
}

Balance.displayName = "Balance";

/**
 * CompactNumber – displays large numbers in compact notation (1.2K, 3.4M, etc.)
 */
interface CompactNumberProps {
  /** The number to format */
  value: number;
  /** Locale (default: en-US) */
  locale?: string;
  /** Maximum fraction digits (default: 1) */
  precision?: number;
  /** Custom className */
  className?: string;
  /** Font size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Font weight */
  weight?: "normal" | "medium" | "semibold" | "bold";
  /** Text alignment */
  align?: "left" | "center" | "right";
}

function CompactNumber({
  value,
  locale = "en-US",
  precision = 1,
  className,
  size = "md",
  weight = "normal",
  align = "right",
}: CompactNumberProps) {
  const formatted = formatCompactNumber(value, { locale, precision });

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl",
  };

  const weightClasses = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
  };

  const alignClasses = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  };

  return (
    <span
      className={cn(
        "font-mono tabular-nums inline-block",
        sizeClasses[size],
        weightClasses[weight],
        alignClasses[align],
        className
      )}
      data-testid="compact-number"
    >
      {formatted}
    </span>
  );
}

CompactNumber.displayName = "CompactNumber";

/**
 * Nonce – displays a nonce (integer, no grouping, no decimals).
 */
interface NonceProps {
  /** The nonce value */
  value: number | bigint;
  /** Custom className */
  className?: string;
  /** Font size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Font weight */
  weight?: "normal" | "medium" | "semibold" | "bold";
  /** Text alignment */
  align?: "left" | "center" | "right";
}

function Nonce({
  value,
  className,
  size = "md",
  weight = "normal",
  align = "right",
}: NonceProps) {
  const formatted = formatNonce(value);

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl",
  };

  const weightClasses = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
  };

  const alignClasses = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  };

  return (
    <span
      className={cn(
        "font-mono tabular-nums inline-block",
        sizeClasses[size],
        weightClasses[weight],
        alignClasses[align],
        className
      )}
      data-testid="nonce"
    >
      {formatted}
    </span>
  );
}

Nonce.displayName = "Nonce";

/**
 * Rate – displays a rate (e.g., calls/sec, cost/call).
 */
interface RateProps {
  /** The rate value */
  value: number;
  /** Unit label (e.g., "calls/sec", "USDC/call") */
  unit: string;
  /** Locale (default: en-US) */
  locale?: string;
  /** Precision (default: 4) */
  precision?: number;
  /** Custom className */
  className?: string;
  /** Font size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Font weight */
  weight?: "normal" | "medium" | "semibold" | "bold";
  /** Text alignment */
  align?: "left" | "center" | "right";
}

function Rate({
  value,
  unit,
  locale = "en-US",
  precision = 4,
  className,
  size = "md",
  weight = "normal",
  align = "right",
}: RateProps) {
  const formatted = formatRate(value, unit, { locale, precision });

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl",
  };

  const weightClasses = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
  };

  const alignClasses = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  };

  return (
    <span
      className={cn(
        "font-mono tabular-nums inline-block",
        sizeClasses[size],
        weightClasses[weight],
        alignClasses[align],
        className
      )}
      data-testid="rate"
    >
      {formatted}
    </span>
  );
}

Rate.displayName = "Rate";

/**
 * Delta – displays a change value with semantic coloring and optional sparkline.
 */
interface DeltaProps extends DeltaFormatOptions {
  /** The delta value */
  value: number;
  /** Asset config for monetary deltas */
  asset?: AssetConfig;
  /** Show as percentage (value is already a percentage) */
  asPercent?: boolean;
  /** Show trend icon */
  showIcon?: boolean;
  /** Variant */
  variant?: "inline" | "badge" | "trend";
  /** Size */
  size?: "sm" | "md" | "lg";
  /** Custom className */
  className?: string;
}

function Delta({
  value,
  asset,
  asPercent = false,
  showIcon = false,
  variant = "inline",
  size = "md",
  className,
  ...props
}: DeltaProps) {
  return (
    <DeltaIndicator
      value={value}
      asPercent={asPercent}
      asset={asset}
      variant={variant}
      size={size}
      showIcon={showIcon}
      className={className}
      {...props}
    />
  );
}

Delta.displayName = "Delta";

/**
 * MetricCard – a compact metric display with value, label, delta, and sparkline.
 * The primary building block for dense dashboards.
 */
interface MetricCardProps {
  /** Metric label */
  label: string;
  /** Current value */
  value: number | bigint;
  /** Asset config for monetary values */
  asset?: AssetConfig;
  /** Delta value */
  delta?: number;
  /** Delta as percentage */
  deltaAsPercent?: boolean;
  /** Asset for monetary delta */
  deltaAsset?: AssetConfig;
  /** Sparklines data points */
  sparklineData?: number[];
  /** Sparkline variant */
  sparklineVariant?: "line" | "area" | "bar";
  /** Status level for the metric */
  status?: "healthy" | "degraded" | "failing" | "unknown";
  /** Custom value formatter */
  formatValue?: (value: number) => string;
  /** Custom className */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

function MetricCard({
  label,
  value,
  asset = SETTLEMENT_ASSET,
  delta,
  deltaAsPercent = false,
  deltaAsset,
  sparklineData,
  sparklineVariant = "line",
  status = "unknown",
  formatValue,
  className,
  onClick,
}: MetricCardProps) {
  const numValue = typeof value === "bigint" ? Number(value) : value;

  const displayValue = formatValue
    ? formatValue(numValue)
    : asset
    ? formatBaseUnits(value, asset)
    : formatCompactNumber(numValue);

  const statusColors: Record<string, string> = {
    healthy: "border-l-green-500",
    degraded: "border-l-amber-500",
    failing: "border-l-red-500",
    unknown: "border-l-gray-400",
  };

  return (
    <div
      className={cn(
        "relative p-4 bg-card border rounded-xl transition-all hover:shadow-md",
        statusColors[status],
        "border-l-4",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }} : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-foreground mt-1 truncate">
            {displayValue}
          </p>
          {delta !== undefined && (
            <Delta
              value={delta}
              asPercent={deltaAsPercent}
              asset={deltaAsset}
              variant="inline"
              size="sm"
              showIcon
              className="mt-1"
            />
          )}
        </div>
        {sparklineData && sparklineData.length > 0 && (
          <div className="flex-shrink-0 ml-4">
            <Sparkline
              data={sparklineData}
              variant={sparklineVariant}
              tone={delta !== undefined ? (delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral") : "neutral"}
              size="md"
              showLastPoint
              formatValue={formatValue}
            />
          </div>
        )}
      </div>
    </div>
  );
}

MetricCard.displayName = "MetricCard";

/**
 * MetricGrid – responsive grid of MetricCard components.
 */
interface MetricGridProps {
  /** Array of metric configurations */
  metrics: MetricCardProps[];
  /** Number of columns (responsive) */
  columns?: { base?: number; sm?: number; md?: number; lg?: number; xl?: number };
  /** Gap between cards */
  gap?: number;
  /** Custom className */
  className?: string;
}

function MetricGrid({
  metrics,
  columns = { base: 1, sm: 2, md: 3, lg: 4, xl: 5 },
  gap = 4,
  className,
}: MetricGridProps) {
  const colClasses = [
    `grid-cols-${columns.base ?? 1}`,
    columns.sm && `sm:grid-cols-${columns.sm}`,
    columns.md && `md:grid-cols-${columns.md}`,
    columns.lg && `lg:grid-cols-${columns.lg}`,
    columns.xl && `xl:grid-cols-${columns.xl}`,
  ].filter(Boolean).join(" ");

  return (
    <div
      className={cn(
        "grid gap-4",
        colClasses,
        className
      )}
      style={{ gap: `${gap}px` }}
      role="list"
      aria-label="Metrics"
    >
      {metrics.map((metric, index) => (
        <MetricCard key={metric.label + index} {...metric} />
      ))}
    </div>
  );
}

MetricGrid.displayName = "MetricGrid";

export {
  Amount,
  StroopsAmount,
  Balance,
  CompactNumber,
  Nonce,
  Rate,
  Delta,
  MetricCard,
  MetricGrid,
};
export type {
  AmountProps,
  StroopsAmountProps,
  BalanceProps,
  CompactNumberProps,
  NonceProps,
  RateProps,
  DeltaProps,
  MetricCardProps,
  MetricGridProps,
};
export { SETTLEMENT_ASSET, STELLAR_NATIVE } from "../lib/numeric-formatting";