/**
 * GasEstimate – Stellar/Soroban transaction cost estimator UI.
 *
 * Shows a live fee estimate before the user signs a transaction.
 * Alerts when network congestion pushes fees above a threshold.
 *
 * Usage:
 *   <GasEstimate
 *     estimate={estimate}
 *     darkMode={darkMode}
 *     onProceed={() => signTransaction()}
 *     onCancel={() => setShowEstimate(false)}
 *   />
 */

import React from "react";
import type {
  GasEstimate as GasEstimateType,
  CongestionLevel,
} from "@/lib/gas-predictor";

interface GasEstimateProps {
  /** The pre-computed fee estimate */
  estimate: GasEstimateType;
  /** Dark mode flag from parent */
  darkMode?: boolean;
  /** Called when the user chooses to proceed despite cost */
  onProceed: () => void;
  /** Called when the user cancels to avoid the tx */
  onCancel: () => void;
  /** Optional override for the proceed button label */
  proceedLabel?: string;
}

const CONGESTION_META: Record<
  CongestionLevel,
  { label: string; bg: string; text: string; border: string; icon: string }
> = {
  low: {
    label: "Low congestion",
    bg: "bg-[#dcfce7]",
    text: "text-[#166534]",
    border: "border-[#166534]/30",
    icon: "●",
  },
  medium: {
    label: "Moderate congestion",
    bg: "bg-[#fef3c7]",
    text: "text-[#92400e]",
    border: "border-[#92400e]/30",
    icon: "●",
  },
  high: {
    label: "High congestion",
    bg: "bg-[#fee2e2]",
    text: "text-[#991b1b]",
    border: "border-[#991b1b]/30",
    icon: "▲",
  },
  severe: {
    label: "Severe congestion",
    bg: "bg-[#fee2e2]",
    text: "text-[#991b1b]",
    border: "border-[#991b1b]/50",
    icon: "◆",
  },
};

export function GasEstimate({
  estimate,
  darkMode,
  onProceed,
  onCancel,
  proceedLabel = "Confirm & Sign",
}: GasEstimateProps) {
  const meta = CONGESTION_META[estimate.congestion];
  const isWarning =
    estimate.congestion === "high" || estimate.congestion === "severe";

  return (
    <div
      className={`rounded-xl border p-5 max-w-sm w-full shadow-sm ${
        darkMode
          ? "bg-[#2A3B4A] border-[#374151] text-[#F9F6F2]"
          : "bg-white border-gray-200 text-[#1E2A35]"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide">
          Estimated Transaction Cost
        </h3>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${meta.bg} ${meta.text} border ${meta.border}`}
        >
          <span aria-hidden="true">{meta.icon}</span>
          {meta.label}
        </span>
      </div>

      {/* Cost breakdown */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <span
            className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}
          >
            Base network fee
          </span>
          <span className="text-sm font-medium">
            {estimate.baseFeeXlm.toFixed(6)} XLM
          </span>
        </div>

        {estimate.resourceFeeXlm > 0 && (
          <div className="flex items-center justify-between">
            <span
              className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}
            >
              Smart-contract resources
            </span>
            <span className="text-sm font-medium">
              {estimate.resourceFeeXlm.toFixed(6)} XLM
            </span>
          </div>
        )}

        <div
          className={`w-full h-px ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
        />

        <div className="flex items-center justify-between">
          <span className="text-base font-semibold">Total estimated</span>
          <span className="text-lg font-bold text-[#007A5C]">
            {estimate.totalXlm.toFixed(4)} XLM
          </span>
        </div>
      </div>

      {/* Congestion / warning banner */}
      {estimate.warning && (
        <div
          className={`rounded-lg p-3 mb-4 text-sm ${
            isWarning
              ? darkMode
                ? "bg-red-900/30 text-red-200 border border-red-800"
                : "bg-red-50 text-red-800 border border-red-200"
              : darkMode
                ? "bg-amber-900/30 text-amber-200 border border-amber-800"
                : "bg-amber-50 text-amber-800 border border-amber-200"
          }`}
          role="alert"
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5">{isWarning ? "⚠️" : "ℹ️"}</span>
            <p>{estimate.warning}</p>
          </div>
        </div>
      )}

      {/* Capacity metre */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-1">
          <span
            className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}
          >
            Ledger capacity usage
          </span>
          <span className="text-xs font-medium">
            {(estimate.stats.ledgerCapacityUsage * 100).toFixed(1)}%
          </span>
        </div>
        <div
          className={`w-full rounded-full h-2 ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
        >
          <div
            className={`h-2 rounded-full transition-all ${
              estimate.stats.ledgerCapacityUsage >= 0.8
                ? "bg-[#991b1b]"
                : estimate.stats.ledgerCapacityUsage >= 0.5
                  ? "bg-[#E86A33]"
                  : "bg-[#007A5C]"
            }`}
            style={{
              width: `${Math.min(estimate.stats.ledgerCapacityUsage * 100, 100)}%`,
            }}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
            darkMode
              ? "bg-[#374151] text-gray-300 hover:bg-[#4B5563]"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Cancel
        </button>
        <button
          onClick={onProceed}
          className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
            isWarning
              ? "bg-[#E86A33] text-white hover:bg-[#E86A33]/90"
              : "bg-[#007A5C] text-white hover:bg-[#007A5C]/90"
          }`}
        >
          {proceedLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Compact inline version — shows just the cost badge.
 * Use inside transaction buttons or form footers.
 */
interface InlineGasBadgeProps {
  estimate: GasEstimateType;
  darkMode?: boolean;
  className?: string;
}

export function InlineGasBadge({
  estimate,
  darkMode,
  className = "",
}: InlineGasBadgeProps) {
  const meta = CONGESTION_META[estimate.congestion];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border ${meta.bg} ${meta.text} ${meta.border} ${className}`}
      title={estimate.warning || undefined}
    >
      <span aria-hidden="true">{meta.icon}</span>
      {estimate.totalXlm.toFixed(4)} XLM
    </span>
  );
}

/**
 * Skeleton loader shown while the estimate is loading.
 */
interface GasEstimateSkeletonProps {
  darkMode?: boolean;
}

export function GasEstimateSkeleton({ darkMode }: GasEstimateSkeletonProps) {
  return (
    <div
      className={`rounded-xl border p-5 max-w-sm w-full animate-pulse ${
        darkMode ? "bg-[#2A3B4A] border-[#374151]" : "bg-white border-gray-200"
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div
          className={`h-4 w-32 rounded ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
        />
        <div
          className={`h-5 w-20 rounded-full ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
        />
      </div>
      <div className="space-y-3 mb-4">
        <div className="flex justify-between">
          <div
            className={`h-3 w-24 rounded ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
          />
          <div
            className={`h-3 w-16 rounded ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
          />
        </div>
        <div
          className={`h-px w-full ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
        />
        <div className="flex justify-between">
          <div
            className={`h-4 w-28 rounded ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
          />
          <div
            className={`h-5 w-20 rounded ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
          />
        </div>
      </div>
      <div className="flex gap-3">
        <div
          className={`h-10 flex-1 rounded-lg ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
        />
        <div
          className={`h-10 flex-1 rounded-lg ${darkMode ? "bg-[#374151]" : "bg-gray-200"}`}
        />
      </div>
    </div>
  );
}

/** Re-export types for convenience. */
export type { GasEstimateType, CongestionLevel };
