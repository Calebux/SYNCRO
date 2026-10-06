/**
 * backend/src/types/usage-reconciliation.ts
 *
 * Types for issue #1445 — reconciliation of usage that was served but not
 * correctly accounted for.
 *
 * The reconciliation job answers one question per window: of everything the
 * gateway actually delivered, how much reached the meter, and how much of that
 * reached channel state? The three deltas between those figures are the
 * signal; in a healthy system all three are zero.
 *
 * Lifecycle of a single served call, as tracked in `meter_usage_ledger`:
 *
 *   reserve ──▶ committed ──▶ settled
 *      │
 *      └──▶ released          (never delivered — error, disconnect)
 *
 * A reservation that reaches neither terminal state before `expires_at` is an
 * orphan, and the reconciler classifies it by which stage it stalled at.
 */

// ─── Ledger lifecycle ─────────────────────────────────────────────────────────

export type MeterUsageStatus = 'reserved' | 'committed' | 'released' | 'expired';

/** Why a served call could not be written to the meter at the time. */
export type DegradedUsageReason =
  /** A critical dependency was degraded, so the meter was not authoritative. */
  | 'degraded_mode'
  /** The meter write itself failed (DB error, timeout). */
  | 'meter_write_failed'
  /** The meter could not be reached at all (no store configured/reachable). */
  | 'meter_unavailable';

export type ReplayState = 'pending' | 'replayed' | 'failed' | 'abandoned';

/** A row in the durable reserve → commit → settle ledger. */
export interface MeterUsageLedgerRow {
  id: string;
  reservationId: string;
  agentId: string;
  route: string;
  unitName: string;
  status: MeterUsageStatus;
  reservedUnits: number;
  reservedAmount: number;
  actualUnits: number | null;
  actualAmount: number | null;
  fallbackUsed: boolean;
  releaseReason: string | null;
  meteredAt: string | null;
  meterIdempotencyKey: string | null;
  settledAt: string | null;
  settlementRef: string | null;
  orphanClass: string | null;
  correlationId: string | null;
  reservedAt: string;
  expiresAt: string;
  committedAt: string | null;
  releasedAt: string | null;
}

/** A served call awaiting application to the meter. */
export interface DegradedUsageLogRow {
  id: string;
  reservationId: string;
  agentId: string;
  route: string;
  unitName: string;
  units: number;
  amount: number;
  reason: DegradedUsageReason;
  servedAt: string;
  correlationId: string | null;
  replayState: ReplayState;
  replayAttempts: number;
  lastError: string | null;
  meterAppliedAt: string | null;
}

// ─── Orphan classification ────────────────────────────────────────────────────

/**
 * Why a reservation never completed its lifecycle. Each class has a distinct
 * remediation, so classifying is what lets the job act safely: it can only
 * auto-repair the classes where the correct action is unambiguous.
 */
export type OrphanClass =
  /**
   * Reserved, never committed, never released, TTL elapsed. The process most
   * likely died between reserve and commit. Whether the upstream was actually
   * called is unknowable, so this is never auto-billed — it is surfaced for an
   * operator to decide against upstream logs.
   */
  | 'crash_between_reserve_and_commit'
  /**
   * Committed (so the request was served and priced) but never applied to the
   * meter. Unbilled revenue — the most serious class. Auto-repairable by
   * replaying the log entry.
   */
  | 'committed_not_metered'
  /**
   * Applied to the meter but never settled into channel state. Auto-repairable
   * by handing the usage to the settlement engine.
   */
  | 'committed_not_settled'
  /** Waiting in the degraded log; replay still pending or retryable. */
  | 'awaiting_degraded_replay'
  /** Released, but only after the TTL had already elapsed. */
  | 'late_release';

/** Orphans that put money at risk and therefore must reach an operator. */
export const BILLING_AFFECTING_ORPHAN_CLASSES: readonly OrphanClass[] = [
  'committed_not_metered',
  'committed_not_settled',
  'awaiting_degraded_replay',
];

export interface OrphanFinding {
  reservationId: string;
  agentId: string;
  route: string;
  orphanClass: OrphanClass;
  /** Amount that should have been billed but may not have been. */
  amount: number;
  units: number | null;
  /** How long the row has been stuck, in ms. */
  stuckForMs: number;
  correlationId: string | null;
  /** True when the job can safely repair this without human input. */
  autoRepairable: boolean;
}

// ─── Report shape ─────────────────────────────────────────────────────────────

export interface ReconciliationAmount {
  count: number;
  amount: number;
}

/** The three deltas between served, metered and settled. */
export interface UsageDeltas {
  /** Served but never applied to the meter — unbilled. */
  servedMinusMetered: number;
  /** Applied to the meter but never settled into channel state. */
  meteredMinusSettled: number;
  /** Served and metered but never settled — the union of the two above. */
  servedMinusSettled: number;
}

export interface ReplayOutcome {
  attempted: number;
  replayed: number;
  replayedAmount: number;
  failed: number;
  abandoned: number;
  /** Entries skipped because the idempotency key showed they were already applied. */
  alreadyApplied: number;
}

export interface SettlementHandoffOutcome {
  /** Usage successfully queued for the settlement engine. */
  handedOff: number;
  handedOffAmount: number;
  /** Usage the settlement queue had no room for — retried on a later run. */
  backpressured: number;
  /** Hand-off attempts that failed for any other reason. */
  failed: number;
}

/**
 * One reconciliation run over one window.
 *
 * `deltas` is the post-repair state (what the system looks like now);
 * `preRepairDeltas` is the state before the job touched anything. Keeping both
 * means an auto-repaired gap is still visible in the audit trail rather than
 * being silently normalised away.
 */
export interface UsageReconciliationReport {
  runId: string;
  windowStart: string;
  windowEnd: string;

  /** Usage delivered and priced in the window. */
  served: ReconciliationAmount;
  /** Usage that actually landed in the meter in the window. */
  metered: ReconciliationAmount;
  /** Usage that reached channel state in the window. */
  settled: ReconciliationAmount;

  deltas: UsageDeltas;
  preRepairDeltas: UsageDeltas;

  replay: ReplayOutcome;
  settlementHandoff: SettlementHandoffOutcome;

  orphans: OrphanFinding[];
  orphanBreakdown: Record<string, { count: number; amount: number }>;

  /** True when all three post-repair deltas are zero. */
  healthy: boolean;
  /** Set when the run itself failed to complete. */
  runError?: string | null;
}

// ─── Service results ──────────────────────────────────────────────────────────

export interface ReserveOutcome {
  reservationId: string;
  /** False when the durable write failed; the caller must then fail closed. */
  persisted: boolean;
}

export interface CommitOutcome {
  reservationId: string;
  /** True when usage was applied to the meter immediately. */
  metered: boolean;
  /** True when the usage was queued in the degraded log for replay instead. */
  queuedForReplay: boolean;
  reason: DegradedUsageReason | null;
}

export interface ReleaseOutcome {
  reservationId: string;
  released: boolean;
}