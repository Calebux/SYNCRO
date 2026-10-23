"use client";

/**
 * DeltaIndicator – displays a numeric change with semantic coloring.
 *
 * Used for: metric deltas, table column changes, sparkline trends.
 * Variants: inline (text), badge (pill), trend (with icon).
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatDelta, formatPercentDelta, type DeltaFormatOptions } from "../lib/numeric-formatting";

const deltaVariants = cva(
  "inline-flex items-center gap-1 font-mono tabular-nums",
  {
    variants: {
      variant: {
        inline: "text-sm",
        badge: "px-2 py-0.5 rounded-full text-xs font-semibold",
        trend: "text-sm font-medium",
      },
      tone: {
        positive: "text-green-600 dark:text-green-400",
        negative: "text-red-600 dark:text-red-400",
        neutral: "text-gray-500 dark:text-gray-400",
      },
      size: {
        sm: "text-xs",
        md: "text-sm",
        lg: "text-base",
      },
    },
    defaultVariants: {
      variant: "inline",
      tone: "neutral",
      size: "md",
    },
  }
);

export interface DeltaIndicatorProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof deltaVariants> {
  /** The numeric delta value (e.g., +150, -50, 0) */
  value: number;
  /** Format as percentage (value is already a percentage, e.g., 5.2 for +5.2%) */
  asPercent?: boolean;
  /** Asset config for monetary deltas */
  asset?: DeltaFormatOptions["asset"];
  /** Number of decimal places */
  precision?: number;
  /** Show the +/- sign (default: true) */
  showSign?: boolean;
  /** Show trend icon (up/down/flat) */
  showIcon?: boolean;
  /** Custom label for screen readers */
  ariaLabel?: string;
}

function DeltaIndicator({
  value,
  asPercent = false,
  asset,
  precision,
  showSign = true,
  showIcon = false,
  variant = "inline",
  tone: toneProp,
  size = "md",
  className,
  ariaLabel,
  ...props
}: DeltaIndicatorProps) {
  const formatted = asPercent
    ? formatPercentDelta(value, { precision, showPlusSign: showSign })
    : formatDelta(value, { precision, showPlusSign: showSign, asset });

  // Determine tone from value if not explicitly provided
  const tone = toneProp === "neutral" && (formatted.isPositive || formatted.isNegative)
    ? formatted.isPositive
      ? "positive"
      : "negative"
    : toneProp;

  const Icon = formatted.isPositive ? TrendingUp : formatted.isNegative ? TrendingDown : Minus;

  const content = (
    <>
      {showIcon && <Icon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />}
      <span aria-hidden="true">{formatted.formatted}</span>
    </>
  );

  const label = ariaLabel ?? (asPercent ? `${formatted.formatted} change` : `${formatted.formatted} delta`);

  return (
    <span
      className={cn(deltaVariants({ variant, tone, size }), className)}
      role="status"
      aria-label={label}
      {...props}
    >
      {content}
    </span>
  );
}

DeltaIndicator.displayName = "DeltaIndicator";

export { DeltaIndicator, deltaVariants };
export type { DeltaFormatOptions };