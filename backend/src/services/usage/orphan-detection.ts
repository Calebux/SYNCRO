/**
 * backend/src/services/usage/orphan-detection.ts
 *
 * Finds reservations that never completed their lifecycle and classifies why
 * (issue #1445).
 *
 * The classification matters more than the detection. An expired reservation
 * could be:
 *
 *   - a crash between reserve and commit — usage may have been delivered, but
 *     there is no priced record, so we cannot bill it automatically;
 *   - served and priced but never applied to the meter — unambiguous, and safe
 *     to repair;
 *   - metered but never settled into channel state — safe to hand to the
 *     settlement engine;
 *   - waiting in the degraded log for replay;
 *   - released, just late.
 *
 * Only the unambiguous ones are auto-repairable. The rest are surfaced with
 * `autoRepairable: false` so an operator decides, because guessing wrong either
 * double-charges an agent or gives away money that was owed.
 */

import { supabase } from '../../config/database';
import logger from '../../config/logger';
import { env } from '../../config/env';
import {
  BILLING_AFFECTING_ORPHAN_CLASSES,
  MeterUsageLedgerRow,
  OrphanClass,
  OrphanFinding,
} from '../../types/usage-reconciliation';
import { toLedgerRows } from './row-mappers';

/** Default scan batch size — keeps one cron tick bounded. */
const DEFAULT_SCAN_LIMIT = 1000;

/** Default grace period before a committed-but-unsettled row counts as an orphan. */
const DEFAULT_SETTLEMENT_GRACE_MS = 15 * 60 * 1000;

export interface OrphanScanOptions {
  /** Only consider reservations that expired at or before this instant. */
  now?: Date;
  /** How many candidate rows to examine per class. */
  limit?: number;
  /** Grace period before an unsettled commit is treated as an orphan. */
  settlementGraceMs?: number;
}

export class OrphanDetectionService {
  /**
   * Detect and classify every stuck reservation.
   *
   * Classified rows are written back to `orphan_class` so the report, the ops
   * dashboard and this scan all agree on a row's state without re-deriving it.
   */
  async scan(options: OrphanScanOptions = {}): Promise<OrphanFinding[]> {
    const now = options.now ?? new Date();
    const limit = options.limit ?? Number(env.USAGE_ORPHAN_SCAN_LIMIT ?? DEFAULT_SCAN_LIMIT);
    const graceMs =
      options.settlementGraceMs ??
      Number(env.USAGE_SETTLEMENT_GRACE_MS ?? DEFAULT_SETTLEMENT_GRACE_MS);

    const [crashed, unmetered, unsettled, awaitingReplay, lateReleases] = await Promise.all([
      this.findCrashedReservations(now, limit),
      this.findCommittedNotMetered(now, limit),
      this.findCommittedNotSettled(now, graceMs, limit),
      this.findAwaitingReplay(now, limit),
      this.findLateReleases(now, limit),
    ]);

    const findings: OrphanFinding[] = this.assignExclusiveClasses([
        ...unmetered.map((r) => this.toFinding(r, 'committed_not_metered', now)),
        ...unsettled.map((r) => this.toFinding(r, 'committed_not_settled', now)),
        ...awaitingReplay.map((r) => this.toFinding(r, 'awaiting_degraded_replay', now)),
        ...lateReleases.map((r) => this.toFinding(r, 'late_release', now)),
        ...crashed.map((r) => this.toFinding(r, 'crash_between_reserve_and_commit', now)),
    ]);

    await this.persistClassifications(findings);

    logger.info('[OrphanDetection] Scan complete', {
      total: findings.length,
      byClass: countByClass(findings),
    });

    return findings;
  }

  /**
   * Reduce findings to exactly one class per reservation.
   *
   * A row can match more than one detector — usage that is committed, not yet
   * metered, *and* sitting in the degraded log is both `committed_not_metered`
   * and `awaiting_degraded_replay`. Since `orphan_class` is a single column,
   * emitting both would let the report disagree with the column and inflate
   * totals. The most specific class wins, because it names the queued action
   * that will actually fix the row.
   */
  private assignExclusiveClasses(findings: OrphanFinding[]): OrphanFinding[] {
    const byPriority: OrphanClass[] = [
      'awaiting_degraded_replay',
      'committed_not_settled',
      'committed_not_metered',
      'late_release',
      'crash_between_reserve_and_commit',
    ];
    const rank = new Map(byPriority.map((c, i) => [c, i]));

    const best = new Map<string, OrphanFinding>();
    for (const finding of findings) {
      const existing = best.get(finding.reservationId);
      if (!existing) {
        best.set(finding.reservationId, finding);
        continue;
      }
      const challenger = rank.get(finding.orphanClass) ?? Number.MAX_SAFE_INTEGER;
      const incumbent = rank.get(existing.orphanClass) ?? Number.MAX_SAFE_INTEGER;
      if (challenger < incumbent) {
        best.set(finding.reservationId, { ...finding, stuckForMs: Math.max(finding.stuckForMs, existing.stuckForMs) });
      }
    }
    return [...best.values()];
  }

  /**
   * Reserved, TTL elapsed, still open. Nothing else happened to the row, which
   * means the process holding it most likely died mid-request.
   */
  private async findCrashedReservations(now: Date, limit: number): Promise<MeterUsageLedgerRow[]> {
    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .select('*')
      .eq('status', 'reserved')
      .lt('expires_at', now.toISOString())
      .order('expires_at', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('[OrphanDetection] Failed to scan crashed reservations', { error: error.message });
      return [];
    }
    return toLedgerRows(data);
  }

  /**
   * Committed means the request was served and priced. If it was never applied
   * to the meter, that is unbilled revenue.
   */
  private async findCommittedNotMetered(now: Date, limit: number): Promise<MeterUsageLedgerRow[]> {
    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .select('*')
      .eq('status', 'committed')
      .is('metered_at', null)
      .lte('committed_at', now.toISOString())
      .order('committed_at', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('[OrphanDetection] Failed to scan unmetered usage', { error: error.message });
      return [];
    }
    return toLedgerRows(data);
  }

  /**
   * Metered but never settled into channel state, past the grace period. Inside
   * the grace period this is normal — settlement is batched and not immediate.
   */
  private async findCommittedNotSettled(
    now: Date,
    graceMs: number,
    limit: number,
  ): Promise<MeterUsageLedgerRow[]> {
    const graceBoundary = new Date(now.getTime() - graceMs).toISOString();

    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .select('*')
      .eq('status', 'committed')
      .is('settled_at', null)
      .not('metered_at', 'is', null)
      .lte('committed_at', graceBoundary)
      .order('committed_at', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('[OrphanDetection] Failed to scan unsettled usage', { error: error.message });
      return [];
    }
    return toLedgerRows(data);
  }

  /**
   * Rows already accounted for by a pending degraded-log entry. These are not
   * lost yet — they are queued — but they are still unbilled until replayed.
   */
  private async findAwaitingReplay(now: Date, limit: number): Promise<MeterUsageLedgerRow[]> {
    const { data, error } = await supabase
      .from('degraded_usage_log')
      .select('reservation_id')
      .in('replay_state', ['pending', 'failed'])
      .lte('served_at', now.toISOString())
      .order('served_at', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('[OrphanDetection] Failed to scan degraded log backlog', { error: error.message });
      return [];
    }

    const reservationIds = ((data as Array<{ reservation_id: string }> | null) ?? []).map(
      (r) => r.reservation_id,
    );
    if (reservationIds.length === 0) return [];

    const { data: rows, error: rowsError } = await supabase
      .from('meter_usage_ledger')
      .select('*')
      .in('reservation_id', reservationIds)
      .is('metered_at', null)
      .limit(limit);

    if (rowsError) {
      logger.error('[OrphanDetection] Failed to resolve degraded log backlog', {
        error: rowsError.message,
      });
      return [];
    }
    return toLedgerRows(rows);
  }

  /**
   * Released, but only after the TTL had already elapsed. Not a billing gap —
   * the usage was never delivered — but it means the request outlived its
   * reservation, which is worth seeing.
   */
  private async findLateReleases(now: Date, limit: number): Promise<MeterUsageLedgerRow[]> {
    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .select('*')
      .eq('status', 'released')
      .not('released_at', 'is', null)
      .not('expires_at', 'is', null)
      .limit(limit);

    if (error) {
      logger.error('[OrphanDetection] Failed to scan late releases', { error: error.message });
      return [];
    }

    // The predicate we actually care about — released after the reservation
    // expired — cannot be expressed portably across PostgREST, so filter here.
    return toLedgerRows(data).filter((row) => {
      if (!row.releasedAt || !row.expiresAt) return false;
      const releasedAt = new Date(row.releasedAt).getTime();
      return releasedAt > new Date(row.expiresAt).getTime() && releasedAt <= now.getTime();
    });
  }

  private toFinding(
    row: MeterUsageLedgerRow,
    orphanClass: OrphanClass,
    now: Date,
  ): OrphanFinding {
    const anchor = row.committedAt ?? row.reservedAt;
    const stuckForMs = Math.max(0, now.getTime() - new Date(anchor).getTime());

    // Amount at risk is the priced amount for delivered usage, and the reserved
    // ceiling for a crash — where we do not know what was actually used.
    const amount =
      orphanClass === 'crash_between_reserve_and_commit'
        ? Number(row.reservedAmount ?? 0)
        : Number(row.actualAmount ?? row.reservedAmount ?? 0);

    return {
      reservationId: row.reservationId,
      agentId: row.agentId,
      route: row.route,
      orphanClass,
      amount,
      units: row.actualUnits ?? null,
      stuckForMs,
      correlationId: row.correlationId ?? null,
      autoRepairable: isAutoRepairable(orphanClass),
    };
  }

  /**
   * Write the classification back so every reader agrees on a row's state.
   *
   * Failing to persist is not fatal to the scan: the in-memory findings are
   * still correct and still reported.
   */
  private async persistClassifications(findings: OrphanFinding[]): Promise<void> {
    if (findings.length === 0) return;

    const results = await Promise.allSettled(
      findings.map((finding) =>
        supabase
          .from('meter_usage_ledger')
          .update({ orphan_class: finding.orphanClass })
          .eq('reservation_id', finding.reservationId)
          .then(({ error }) => {
            if (error) {
              logger.warn('[OrphanDetection] Failed to persist classification', {
                reservationId: finding.reservationId,
                orphanClass: finding.orphanClass,
                error: error.message,
              });
            }
          }),
      ),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      logger.error('[OrphanDetection] Some classifications could not be persisted', { failed });
    }
  }

  /**
   * Clear the classification from rows that are healthy again, so a repaired
   * orphan does not stay flagged forever.
   */
  async clearStaleClassifications(limit = DEFAULT_SCAN_LIMIT): Promise<number> {
    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .select('reservation_id')
      .not('orphan_class', 'is', null)
      .not('metered_at', 'is', null)
      .not('settled_at', 'is', null)
      .limit(limit);

    if (error) {
      logger.warn('[OrphanDetection] Failed to read stale classifications', { error: error.message });
      return 0;
    }

    const ids = ((data as Array<{ reservation_id: string }> | null) ?? []).map(
      (r) => r.reservation_id,
    );
    if (ids.length === 0) return 0;

    const { error: clearError } = await supabase
      .from('meter_usage_ledger')
      .update({ orphan_class: null })
      .in('reservation_id', ids);

    if (clearError) {
      logger.warn('[OrphanDetection] Failed to clear stale classifications', {
        error: clearError.message,
      });
      return 0;
    }
    return ids.length;
  }
}

export function isAutoRepairable(orphanClass: OrphanClass): boolean {
  switch (orphanClass) {
    case 'committed_not_metered':
    case 'committed_not_settled':
    case 'awaiting_degraded_replay':
      return true;
    case 'crash_between_reserve_and_commit':
    case 'late_release':
      return false;
    default:
      return false;
  }
}

/** True when this class puts real money at stake. */
export function isBillingAffecting(orphanClass: OrphanClass): boolean {
  return BILLING_AFFECTING_ORPHAN_CLASSES.includes(orphanClass);
}

export function countByClass(findings: OrphanFinding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.orphanClass] = (acc[finding.orphanClass] ?? 0) + 1;
    return acc;
  }, {});
}

export function sumByClass(findings: OrphanFinding[]): Record<string, { count: number; amount: number }> {
  return findings.reduce<Record<string, { count: number; amount: number }>>((acc, finding) => {
    const bucket = acc[finding.orphanClass] ?? { count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += finding.amount;
    acc[finding.orphanClass] = bucket;
    return acc;
  }, {});
}

export const orphanDetectionService = new OrphanDetectionService();