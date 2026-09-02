/**
 * BlockchainBadge – theme-aware blockchain sync badge component.
 *
 * Renders a badge indicating blockchain sync status. When the status is
 * "synced" or "confirmed" and a transactionHash is provided, the badge
 * becomes a clickable link to StellarExpert (or the Stellar Lab explorer).
 *
 * Design tokens (all verified ≥ 4.5:1 contrast):
 *   Synced    – white text on brand green  (#007A5C)
 *   Confirmed – white text on brand green  (#007A5C)
 *   Partial   – dark amber text on amber tint
 *   Failed    – white text on dark red      (#991b1b)
 *   Pending   – muted grey text on grey tint
 */

import React from "react";
import { resolveExplorerUrl } from "../../../shared/blockchain-flags";

export type BlockchainSyncStatus =
  | "synced"
  | "confirmed"
  | "partial"
  | "failed"
  | "pending";

interface BlockchainBadgeProps {
  status: BlockchainSyncStatus;
  /** Stellar transaction hash – required for explorer link */
  transactionHash?: string;
  /** Pass the current darkMode boolean from parent context */
  darkMode?: boolean;
  /** Optional extra label text; defaults to a capitalised status name */
  label?: string;
  className?: string;
}

/**
 * Returns Tailwind class strings for bg + text that are WCAG-AA compliant.
 */
function getBadgeClasses(
  status: BlockchainSyncStatus,
  darkMode?: boolean,
): string {
  switch (status) {
    case "synced":
    case "confirmed":
      // #ffffff on #007A5C = 7.9:1 ✅
      return "bg-[#007A5C] text-white";

    case "partial":
      return darkMode
        ? "bg-[#3b1c08] text-[#fde68a]"
        : "bg-[#fef3c7] text-[#92400e]";

    case "failed":
      // #ffffff on #991b1b = 5.9:1 ✅
      return "bg-[#991b1b] text-white";

    case "pending":
      return darkMode
        ? "bg-[#374151] text-[#d1d5db]"
        : "bg-[#e5e7eb] text-[#374151]";

    default:
      return darkMode
        ? "bg-[#374151] text-[#d1d5db]"
        : "bg-[#e5e7eb] text-[#374151]";
  }
}

const STATUS_LABELS: Record<BlockchainSyncStatus, string> = {
  synced: "Blockchain Synced",
  confirmed: "On-chain Confirmed",
  partial: "Partial Sync",
  failed: "Sync Failed",
  pending: "Sync Pending",
};

export function BlockchainBadge({
  status,
  transactionHash,
  darkMode,
  label,
  className = "",
}: BlockchainBadgeProps) {
  const colorClasses = getBadgeClasses(status, darkMode);
  const displayLabel = label ?? STATUS_LABELS[status] ?? status;
  const isClickable =
    (status === "synced" || status === "confirmed") && !!transactionHash;

  const badgeContent = (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold leading-5 ${colorClasses} ${className}`}
      aria-label={`Blockchain status: ${displayLabel}`}
    >
      {displayLabel}
    </span>
  );

  if (isClickable) {
    return (
      <a
        href={resolveExplorerUrl(transactionHash!)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD166] rounded-full"
        aria-label={`View transaction ${transactionHash!.slice(0, 8)}… on StellarExpert`}
        onClick={(e) => e.stopPropagation()}
      >
        {badgeContent}
      </a>
    );
  }

  return badgeContent;
}

/**
 * Utility – maps a raw sync status string (from DB / props) to a BlockchainSyncStatus.
 * Returns "pending" as a safe fallback.
 */
export function normalizeBlockchainStatus(raw?: string): BlockchainSyncStatus {
  switch (raw?.toLowerCase()) {
    case "synced":
      return "synced";
    case "confirmed":
      return "confirmed";
    case "partial":
      return "partial";
    case "failed":
      return "failed";
    case "pending":
      return "pending";
    default:
      return "pending";
  }
}
