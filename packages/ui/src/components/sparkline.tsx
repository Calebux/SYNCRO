"use client";

/**
 * Sparkline – minimal inline time-series chart.
 *
 * No axes, no tooltips, no interaction — just a quick visual trend.
 * Uses SVG for crisp rendering at any size.
 * Variants: line, area, bar (for discrete values).
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { formatCompactNumber } from "../lib/numeric-formatting";

const sparklineVariants = cva(
  "inline-block align-middle",
  {
    variants: {
      variant: {
        line: "",
        area: "",
        bar: "",
      },
      tone: {
        positive: "",
        negative: "",
        neutral: "",
        info: "",
      },
      size: {
        sm: "h-4 w-16",
        md: "h-6 w-24",
        lg: "h-8 w-32",
        xl: "h-10 w-40",
      },
    },
    defaultVariants: {
      variant: "line",
      tone: "neutral",
      size: "md",
    },
  }
);

export interface SparklineProps
  extends React.SVGAttributes<SVGSVGElement>,
    VariantProps<typeof sparklineVariants> {
  /** Data points for the sparkline */
  data: number[];
  /** Show a dot for the last data point */
  showLastPoint?: boolean;
  /** Show the current value as a label */
  showValue?: boolean;
  /** Custom value formatter (receives the last data point) */
  formatValue?: (value: number) => string;
  /** Accessible label for the chart */
  ariaLabel?: string;
  /** Stroke width for line/area variants */
  strokeWidth?: number;
  /** Animation duration in ms (0 to disable) */
  animationDuration?: number;
}

function Sparkline({
  data,
  variant = "line",
  tone = "neutral",
  size = "md",
  showLastPoint = true,
  showValue = false,
  formatValue,
  ariaLabel,
  strokeWidth = 1.5,
  animationDuration = 300,
  className,
  style,
  ...props
}: SparklineProps) {
  if (data.length === 0) {
    return (
      <svg
        className={cn(sparklineVariants({ variant, tone, size }), className)}
        aria-hidden="true"
        style={style}
        {...props}
      />
    );
  }

  const width = parseInt(size.split("-")[1] || "24") * 4; // rough mapping
  const height = parseInt(size.split("-")[1] || "6") * 4;

  // Normalize data to 0-1 range
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const normalized = data.map((v) => (v - min) / range);

  // Generate SVG path
  const points = normalized.map((v, i) => ({
    x: (i / (data.length - 1 || 1)) * width,
    y: height - v * height,
  }));

  const pathData = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  // Area path (line + bottom edge)
  const areaPathData =
    pathData + ` L ${width} ${height} L 0 ${height} Z`;

  // Tone-based colors
  const toneColors: Record<string, { stroke: string; fill: string; dot: string }> = {
    positive: { stroke: "#22c55e", fill: "rgba(34, 197, 94, 0.15)", dot: "#22c55e" },
    negative: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.15)", dot: "#ef4444" },
    neutral: { stroke: "#6b7280", fill: "rgba(107, 114, 128, 0.15)", dot: "#6b7280" },
    info: { stroke: "#3b82f6", fill: "rgba(59, 130, 246, 0.15)", dot: "#3b82f6" },
  };

  const colors = toneColors[tone] ?? toneColors.neutral;
  const lastValue = data[data.length - 1];
  const formattedValue = formatValue ? formatValue(lastValue) : formatCompactNumber(lastValue);

  return (
    <svg
      className={cn(sparklineVariants({ variant, tone, size }), className)}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel ?? `Sparkline showing ${data.length} data points, current value ${formattedValue}`}
      style={style}
      {...props}
    >
      {/* Animation keyframes */}
      <defs>
        <style>{`
          .sparkline-path {
            stroke-dasharray: ${pathData.length * 2};
            stroke-dashoffset: ${pathData.length * 2};
            animation: sparkline-draw ${animationDuration}ms ease-out forwards;
          }
          @keyframes sparkline-draw {
            to { stroke-dashoffset: 0; }
          }
          .sparkline-area {
            animation: sparkline-fade ${animationDuration}ms ease-out forwards;
            opacity: 0;
          }
          @keyframes sparkline-fade {
            to { opacity: 1; }
          }
        `}</style>
      </defs>

      {/* Area fill */}
      {variant === "area" && (
        <path
          className="sparkline-area"
          d={areaPathData}
          fill={colors.fill}
          fillOpacity={0.3}
        />
      )}

      {/* Line path */}
      {(variant === "line" || variant === "area") && (
        <path
          className={animationDuration > 0 ? "sparkline-path" : ""}
          d={pathData}
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* Bar variant */}
      {variant === "bar" && (
        <g>
          {points.map((p, i) => (
            <rect
              key={i}
              x={p.x - width / data.length / 2}
              y={p.y}
              width={Math.max(1, width / data.length * 0.6)}
              height={height - p.y}
              fill={colors.stroke}
              rx={0.5}
            />
          ))}
        </g>
      )}

      {/* Last point indicator */}
      {showLastPoint && data.length > 1 && variant !== "bar" && (
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={strokeWidth * 2}
          fill={colors.dot}
          stroke="white"
          strokeWidth={1}
        />
      )}
    </svg>
  );
}

Sparkline.displayName = "Sparkline";

/**
 * Sparkline with a value label — convenient wrapper for metric cards.
 */
export interface SparklineWithValueProps extends Omit<SparklineProps, "showValue"> {
  /** Current value to display */
  value: number;
  /** Optional delta to show alongside */
  delta?: number;
  /** Delta as percentage */
  deltaAsPercent?: boolean;
  /** Asset for monetary delta */
  deltaAsset?: SparklineProps["formatValue"] extends (value: number) => string ? never : import("../lib/numeric-formatting").AssetConfig;
  /** Label for the metric */
  label?: string;
}

export function SparklineWithValue({
  value,
  data,
  delta,
  deltaAsPercent = false,
  deltaAsset,
  label,
  size = "md",
  variant = "line",
  tone = "neutral",
  formatValue,
  className,
  ...props
}: SparklineWithValueProps) {
  const sparklineTone = delta !== undefined
    ? delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral"
    : tone;

  return (
    <div className={cn("inline-flex flex-col items-end gap-1", className)}>
      {label && <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>}
      <div className="flex items-baseline gap-2">
        <Sparkline
          data={data}
          variant={variant}
          tone={sparklineTone}
          size={size}
          formatValue={formatValue}
          {...props}
        />
        <div className="flex flex-col items-end">
          <span className="font-mono tabular-nums font-semibold text-gray-900 dark:text-white">
            {formatValue ? formatValue(value) : formatCompactNumber(value)}
          </span>
          {delta !== undefined && (
            <DeltaIndicator
              value={delta}
              asPercent={deltaAsPercent}
              asset={deltaAsset}
              variant="inline"
              size="sm"
              showIcon
            />
          )}
        </div>
      </div>
    </div>
  );
}

export { Sparkline, sparklineVariants };
export { DeltaIndicator } from "./delta-indicator";