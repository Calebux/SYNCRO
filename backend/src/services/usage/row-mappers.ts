/**
 * backend/src/services/usage/row-mappers.ts
 *
 * Supabase/PostgREST returns rows keyed by the *database column names*, which are
 * snake_case. The interfaces in `types/usage-reconciliation.ts` are camelCase.
 *
 * A bare `data as MeterUsageLedgerRow[]` cast satisfies the compiler while
 * producing objects where every field is `undefined` at runtime — the type
 * assertion is a lie, and it fails silently at the first `row.reservationId`.
 * These mappers are the only sanctioned path from a DB row to a typed domain
 * object.
 *
 * `numeric` columns are also coerced explicitly: PostgREST may hand them back as
 * a JSON number or as a string depending on the column's declared precision, and
 * `Number()` normalises both. Non-finite values collapse to 0 rather than
 * poisoning downstream sums with NaN.
 */

import type {
  DegradedUsageLogRow,
  MeterUsageLedgerRow,
  ReplayState,
  UsageReconciliationReport,
} from '../../types/usage-reconciliation';

// ─── numeric coercion ────────────────────────────────────────────────────────

/**
 * Coerce a possibly-string possibly-absent numeric column to a finite number.
 *
 * Amounts are money: a NaN that slipped into a sum would silently zero out an
 * entire reconciliation report, so anything unparseable becomes 0 and is
 * visible as a wrong count rather than a wrong total nobody can explain.
 */
function num(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown): boolean {
  return value === true || value === 'true';
}

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

// ─── meter_usage_ledger ──────────────────────────────────────────────────────

/** Raw row shape as returned by `.select('*')` on `meter_usage_ledger`. */
export interface LedgerDbRow {
  id?: unknown;
  reservation_id?: unknown;
  agent_id?: unknown;
  route?: unknown;
  unit_name?: unknown;
  status?: unknown;
  reserved_units?: unknown;
  reserved_amount?: unknown;
  actual_units?: unknown;
  actual_amount?: unknown;
  fallback_used?: unknown;
  release_reason?: unknown;
  metered_at?: unknown;
  meter_idempotency_key?: unknown;
  settled_at?: unknown;
  settlement_ref?: unknown;
  orphan_class?: unknown;
  correlation_id?: unknown;
  reserved_at?: unknown;
  expires_at?: unknown;
  committed_at?: unknown;
  released_at?: unknown;
}

export function toLedgerRow(row: LedgerDbRow): MeterUsageLedgerRow {
  return {
    id: str(row.id) ?? '',
    reservationId: str(row.reservation_id) ?? '',
    agentId: str(row.agent_id) ?? '',
    route: str(row.route) ?? '',
    unitName: str(row.unit_name) ?? '',
    status: (str(row.status) ?? 'reserved') as MeterUsageLedgerRow['status'],
    reservedUnits: num(row.reserved_units),
    reservedAmount: num(row.reserved_amount),
    actualUnits: row.actual_units === null || row.actual_units === undefined ? null : num(row.actual_units),
    actualAmount: row.actual_amount === null || row.actual_amount === undefined ? null : num(row.actual_amount),
    fallbackUsed: bool(row.fallback_used),
    releaseReason: str(row.release_reason),
    meteredAt: str(row.metered_at),
    meterIdempotencyKey: str(row.meter_idempotency_key),
    settledAt: str(row.settled_at),
    settlementRef: str(row.settlement_ref),
    orphanClass: str(row.orphan_class),
    correlationId: str(row.correlation_id),
    reservedAt: str(row.reserved_at) ?? new Date(0).toISOString(),
    expiresAt: str(row.expires_at) ?? new Date(0).toISOString(),
    committedAt: str(row.committed_at),
    releasedAt: str(row.released_at),
  };
}

export function toLedgerRows(rows: LedgerDbRow[] | null | undefined): MeterUsageLedgerRow[] {
  return (rows ?? []).map(toLedgerRow);
}

// ─── degraded_usage_log ──────────────────────────────────────────────────────

/** Raw row shape as returned by `.select('*')` on `degraded_usage_log`. */
export interface DegradedUsageDbRow {
  id?: unknown;
  reservation_id?: unknown;
  agent_id?: unknown;
  route?: unknown;
  unit_name?: unknown;
  units?: unknown;
  amount?: unknown;
  reason?: unknown;
  served_at?: unknown;
  correlation_id?: unknown;
  replay_state?: unknown;
  replay_attempts?: unknown;
  last_error?: unknown;
  meter_applied_at?: unknown;
}

export function toDegradedUsageRow(row: DegradedUsageDbRow): DegradedUsageLogRow {
  return {
    id: str(row.id) ?? '',
    reservationId: str(row.reservation_id) ?? '',
    agentId: str(row.agent_id) ?? '',
    route: str(row.route) ?? '',
    unitName: str(row.unit_name) ?? '',
    units: num(row.units),
    amount: num(row.amount),
    reason: (str(row.reason) ?? 'meter_write_failed') as DegradedUsageLogRow['reason'],
    servedAt: str(row.served_at) ?? new Date(0).toISOString(),
    correlationId: str(row.correlation_id),
    replayState: (str(row.replay_state) ?? 'pending') as ReplayState,
    replayAttempts: num(row.replay_attempts),
    lastError: str(row.last_error),
    meterAppliedAt: str(row.meter_applied_at),
  };
}

export function toDegradedUsageRows(
  rows: DegradedUsageDbRow[] | null | undefined,
): DegradedUsageLogRow[] {
  return (rows ?? []).map(toDegradedUsageRow);
}
