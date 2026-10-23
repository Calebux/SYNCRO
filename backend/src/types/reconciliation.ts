/**
 * backend/src/types/reconciliation.ts
 *
 * Place at: backend/src/types/reconciliation.ts (new file)
 *
 * Types for issue #1278 — continuous reconciliation between on-chain state
 * and the backend ledger.
 */

/** The three invariants this system enforces, per the issue scope. */
export enum InvariantType {
  /** Every backend renewal record must have a confirmed on-chain tx. */
  BACKEND_HAS_CHAIN_CONFIRMATION = 'BACKEND_HAS_CHAIN_CONFIRMATION',
  /** Every on-chain renewal event must have a backend record. */
  CHAIN_HAS_BACKEND_RECORD = 'CHAIN_HAS_BACKEND_RECORD',
  /** Balances (escrow / contract vs. ledger) must agree within tolerance. */
  BALANCE_WITHIN_TOLERANCE = 'BALANCE_WITHIN_TOLERANCE',
}

/** Discrepancy classification — each type has exactly one resolution path. */
export enum DiscrepancyType {
  /** Backend says renewed, no matching confirmed on-chain tx exists at all. */
  MISSING_ONCHAIN_TX = 'MISSING_ONCHAIN_TX',
  /** Backend says renewed, on-chain tx exists but hasn't reached finality yet. */
  UNCONFIRMED_ONCHAIN_TX = 'UNCONFIRMED_ONCHAIN_TX',
  /** Backend says renewed, on-chain tx exists but reverted/failed. */
  FAILED_ONCHAIN_TX = 'FAILED_ONCHAIN_TX',
  /** On-chain renewal event exists, no backend record (indexer/webhook gap). */
  MISSING_BACKEND_RECORD = 'MISSING_BACKEND_RECORD',
  /** Backend record exists but was built from a block later reorged out. */
  REORGED_OUT = 'REORGED_OUT',
  /** Balance delta between contract/escrow and ledger exceeds tolerance. */
  BALANCE_MISMATCH = 'BALANCE_MISMATCH',
  /** Amount recorded in backend differs from amount emitted on-chain. */
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
}

export enum ResolutionAction {
  /** Re-run the indexer/webhook ingestion for the affected block range. */
  AUTO_REINDEX = 'AUTO_REINDEX',
  /** Wait — record stays PENDING until confirmations threshold is met. */
  AUTO_WAIT_FOR_CONFIRMATION = 'AUTO_WAIT_FOR_CONFIRMATION',
  /** Mark the backend record as failed/rolled back automatically. */
  AUTO_MARK_FAILED = 'AUTO_MARK_FAILED',
  /** Roll back a record built on a reorged block and re-derive from canonical chain. */
  AUTO_REPLAY_FROM_CANONICAL = 'AUTO_REPLAY_FROM_CANONICAL',
  /** Funds-affecting — requires a human to review before any write happens. */
  MANUAL_REVIEW_REQUIRED = 'MANUAL_REVIEW_REQUIRED',
}

export type DiscrepancySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface DiscrepancyRecord {
  id?: string;
  detectedAt: string; // ISO timestamp
  invariant: InvariantType;
  discrepancyType: DiscrepancyType;
  severity: DiscrepancySeverity;
  /** Backend subscription/renewal record id, if applicable. */
  renewalRecordId?: string | null;
  /** On-chain tx hash, if applicable. */
  txHash?: string | null;
  /** Ledger/contract address involved. */
  contractId?: string | null;
  /** Backend-recorded amount (stroops or smallest unit) vs chain amount. */
  backendAmount?: string | null;
  onChainAmount?: string | null;
  /** Free-form details for the ops dashboard / audit trail. */
  details: Record<string, unknown>;
  resolutionAction: ResolutionAction;
  resolutionStatus: 'pending' | 'auto_resolved' | 'resolved' | 'unresolved';
  resolvedAt?: string | null;
  resolutionNotes?: string | null;
}

export interface ReconciliationRunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: 'sliding_window' | 'full_sweep';
  windowStart?: string;
  windowEnd?: string;
  recordsChecked: number;
  discrepanciesFound: DiscrepancyRecord[];
  /** Ms between the latest chain block time and now — used for lag alerting. */
  reconciliationLagMs: number;
}

/** Thresholds driving alert firing — tune per environment. */
export interface ReconciliationAlertThresholds {
  /** Fire an alert if open discrepancy count exceeds this. */
  maxOpenDiscrepancies: number;
  /** Fire an alert if any single discrepancy is 'critical' severity. */
  alertOnAnyCritical: boolean;
  /** Fire an alert if reconciliation lag exceeds this many ms. */
  maxReconciliationLagMs: number;
}