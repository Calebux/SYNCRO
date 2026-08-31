/**
 * GasEstimateModal – Pre-transaction fee-estimation overlay.
 *
 * Activated before any Stellar/Soroban transaction is signed.
 * Shows live network fee stats, congestion level, and a cost breakdown.
 * The user must explicitly confirm before the tx proceeds.
 *
 * Usage:
 *   {showGasEstimate && (
 *     <GasEstimateModal
 *       soroban={true}
 *       resources={{ instructions: 1_500_000 }}
 *       darkMode={darkMode}
 *       onConfirm={handleSign}
 *       onClose={() => setShowGasEstimate(false)}
 *     />
 *   )}
 */

"use client";

import React from "react";
import { useGasEstimate } from "@/hooks/use-gas-estimate";
import {
  GasEstimate,
  InlineGasBadge,
  GasEstimateSkeleton,
} from "@/components/ui/gas-estimate";
import type { SorobanResourceEstimate } from "@/lib/gas-predictor";

interface GasEstimateModalProps {
  soroban?: boolean;
  resources?: SorobanResourceEstimate;
  thresholdXlm?: number;
  darkMode?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  title?: string;
}

export default function GasEstimateModal({
  soroban = false,
  resources,
  thresholdXlm,
  darkMode,
  onConfirm,
  onClose,
  title = "Confirm Transaction",
}: GasEstimateModalProps) {
  const { estimate, loading, error, refresh, exceedsThreshold } =
    useGasEstimate({ soroban, resources, thresholdXlm, autoFetch: true });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gas-estimate-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        className={`relative z-10 w-full max-w-md rounded-2xl shadow-xl border ${
          darkMode
            ? "bg-[#1E2A35] border-[#374151]"
            : "bg-white border-gray-200"
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            darkMode ? "border-[#374151]" : "border-gray-100"
          }`}
        >
          <h2
            id="gas-estimate-title"
            className={`text-lg font-semibold ${
              darkMode ? "text-[#F9F6F2]" : "text-[#1E2A35]"
            }`}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className={`text-sm rounded-md px-2 py-1 transition-colors ${
              darkMode
                ? "text-gray-400 hover:text-white hover:bg-[#374151]"
                : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
            }`}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {loading && <GasEstimateSkeleton darkMode={darkMode} />}

          {error && (
            <div
              className={`rounded-lg p-4 border ${
                darkMode
                  ? "bg-red-900/20 border-red-800 text-red-200"
                  : "bg-red-50 border-red-200 text-red-800"
              }`}
            >
              <p className="text-sm font-medium">
                Unable to fetch fee estimate
              </p>
              <p className="text-xs mt-1 opacity-80">{error}</p>
              <button
                onClick={refresh}
                className={`mt-3 text-xs font-semibold underline ${
                  darkMode ? "text-red-300" : "text-red-700"
                }`}
              >
                Retry
              </button>
            </div>
          )}

          {estimate && !loading && (
            <>
              <GasEstimate
                estimate={estimate}
                darkMode={darkMode}
                onProceed={() => {
                  onConfirm();
                  onClose();
                }}
                onCancel={onClose}
                proceedLabel={
                  exceedsThreshold ? "Proceed Anyway" : "Confirm & Sign"
                }
              />

              {/* Refresh timestamp */}
              <p
                className={`text-center text-xs mt-3 ${
                  darkMode ? "text-gray-500" : "text-gray-400"
                }`}
              >
                Fees reflect ledger #{estimate.stats.lastLedger} ·{" "}
                <button
                  onClick={refresh}
                  className="underline hover:text-[#007A5C]"
                >
                  Refresh
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
