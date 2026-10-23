"use client";

/**
 * StatusTreatment – unified status display for system health, service status,
 * and operational states.
 *
 * Three-tier model:
 *   • healthy   – operating normally (green)
 *   • degraded  – impaired but functional (amber/yellow)
 *   • failing   – broken or critical (red)
 *
 * Variants: dot (indicator), badge (pill), banner (full-width), inline (text).
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { CheckCircle2, AlertTriangle, XCircle, Circle, HelpCircle } from "lucide-react";

export type StatusLevel = "healthy" | "degraded" | "failing" | "unknown";

const statusColors: Record<StatusLevel, { bg: string; text: string; border: string; dot: string }> = {
  healthy: {
    bg: "bg-green-50 dark:bg-green-950/30",
    text: "text-green-700 dark:text-green-400",
    border: "border-green-200 dark:border-green-800",
    dot: "bg-green-500",
  },
  degraded: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
    dot: "bg-amber-500",
  },
  failing: {
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-700 dark:text-red-400",
    border: "border-red-200 dark:border-red-800",
    dot: "bg-red-500",
  },
  unknown: {
    bg: "bg-gray-50 dark:bg-gray-800",
    text: "text-gray-600 dark:text-gray-400",
    border: "border-gray-200 dark:border-gray-700",
    dot: "bg-gray-400",
  },
};

const statusIcons: Record<StatusLevel, React.ComponentType<{ className?: string }>> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  failing: XCircle,
  unknown: HelpCircle,
};

const statusLabels: Record<StatusLevel, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failing: "Failing",
  unknown: "Unknown",
};

const statusTreatmentVariants = cva(
  "inline-flex items-center gap-1.5 font-medium",
  {
    variants: {
      variant: {
        dot: "text-sm",
        badge: "px-2.5 py-0.5 rounded-full text-xs font-semibold",
        banner: "px-4 py-3 rounded-lg border",
        inline: "text-sm",
      },
      level: {
        healthy: "",
        degraded: "",
        failing: "",
        unknown: "",
      },
      size: {
        sm: "text-xs",
        md: "text-sm",
        lg: "text-base",
      },
    },
    defaultVariants: {
      variant: "dot",
      level: "unknown",
      size: "md",
    },
  }
);

interface StatusTreatmentProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusTreatmentVariants> {
  /** Current status level */
  level: StatusLevel;
  /** Custom label (defaults to level name) */
  label?: string;
  /** Show the status icon */
  showIcon?: boolean;
  /** Show a pulsing animation on the dot (for live status) */
  pulse?: boolean;
  /** Additional context text */
  description?: string;
}

function StatusTreatment({
  level,
  label,
  variant = "dot",
  size = "md",
  showIcon = true,
  pulse = false,
  description,
  className,
  children,
  ...props
}: StatusTreatmentProps) {
  const colors = statusColors[level];
  const Icon = statusIcons[level];
  const displayLabel = label ?? statusLabels[level];

  const baseClasses = cn(
    statusTreatmentVariants({ variant, level, size }),
    variant === "banner" && colors.bg,
    variant === "banner" && colors.border,
    variant === "badge" && `${colors.bg} ${colors.text}`,
    className
  );

  const dotClasses = cn(
    "w-2 h-2 rounded-full flex-shrink-0",
    colors.dot,
    pulse && "animate-pulse"
  );

  const iconClasses = cn(
    "w-3 h-3 flex-shrink-0",
    colors.text
  );

  if (variant === "banner") {
    return (
      <div
        className={baseClasses}
        role="status"
        aria-live="polite"
        {...props}
      >
        <div className="flex items-center gap-3">
          {showIcon && <Icon className={iconClasses} aria-hidden="true" />}
          <div className="flex-1 min-w-0">
            <p className={cn("font-medium truncate", colors.text)}>
              {displayLabel}
            </p>
            {description && (
              <p className={cn("text-sm truncate", colors.text.replace("700", "600").replace("400", "500"))}>
                {description}
              </p>
            )}
          </div>
          {children}
        </div>
      </div>
    );
  }

  if (variant === "badge") {
    return (
      <span
        className={baseClasses}
        role="status"
        aria-live="polite"
        {...props}
      >
        {showIcon && (
          <span className="relative flex items-center justify-center" style={{ width: 6, height: 6 }}>
            <span className={cn(dotClasses, "absolute inset-0")} aria-hidden="true" />
          </span>
        )}
        {displayLabel}
      </span>
    );
  }

  // dot and inline variants
  return (
    <span
      className={baseClasses}
      role="status"
      aria-live="polite"
      {...props}
    >
      {variant === "dot" && showIcon && (
        <span className="relative flex items-center justify-center" style={{ width: 8, height: 8 }}>
          <span className={cn(dotClasses, "absolute inset-0")} aria-hidden="true" />
          {pulse && <span className={cn(dotClasses, "absolute inset-0 animate-ping opacity-75")} aria-hidden="true" />}
        </span>
      )}
      {variant === "inline" && showIcon && <Icon className={iconClasses} aria-hidden="true" />}
      {displayLabel}
    </span>
  );
}

StatusTreatment.displayName = "StatusTreatment";

/**
 * StatusDot – minimal indicator dot for dense layouts (tables, lists).
 */
interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  level: StatusLevel;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  tooltip?: string;
}

function StatusDot({ level, size = "md", pulse = false, tooltip, className, ...props }: StatusDotProps) {
  const colors = statusColors[level];
  const sizeClasses = { sm: "w-1.5 h-1.5", md: "w-2 h-2", lg: "w-3 h-3" };

  return (
    <span
      className={cn("inline-flex items-center justify-center", sizeClasses[size], className)}
      role="status"
      aria-label={tooltip ?? statusLabels[level]}
      {...props}
    >
      <span
        className={cn("rounded-full", colors.dot, pulse && "animate-pulse")}
        aria-hidden="true"
      />
      {tooltip && <span className="sr-only">{tooltip}</span>}
    </span>
  );
}

StatusDot.displayName = "StatusDot";

/**
 * StatusBadge – pill-shaped status for compact display.
 * Convenience wrapper around StatusTreatment with variant="badge".
 */
interface StatusBadgeProps extends Omit<StatusTreatmentProps, "variant"> {
  variant?: "badge";
}

function StatusBadge(props: StatusBadgeProps) {
  return <StatusTreatment {...props} variant="badge" />;
}

StatusBadge.displayName = "StatusBadge";

/**
 * StatusBanner – full-width banner for page-level status.
 * Convenience wrapper around StatusTreatment with variant="banner".
 */
interface StatusBannerProps extends Omit<StatusTreatmentProps, "variant"> {
  variant?: "banner";
  /** Action button for the banner */
  action?: React.ReactNode;
}

function StatusBanner({ action, children, ...props }: StatusBannerProps) {
  return (
    <StatusTreatment {...props} variant="banner">
      {action ?? children}
    </StatusTreatment>
  );
}

StatusBanner.displayName = "StatusBanner";

export {
  StatusTreatment,
  StatusDot,
  StatusBadge,
  StatusBanner,
  statusTreatmentVariants,
};
export type { StatusLevel, StatusTreatmentProps, StatusDotProps, StatusBadgeProps, StatusBannerProps };