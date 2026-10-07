/**
 * backend/src/services/usage/usage-reconciliation.ts
 *
 * The reconciliation job for issue #1445: reconciles usage that was served but
 * not correctly accounted for — degraded-mode metering, crashes between reserve
 * and commit, and settlement failures.
 *
 * One run, one window, five steps:
 *
 *   1. Measure  — served / metered / settled over the window, and the deltas.
 *   2. Detect   — find and classify every orphaned reservation.
 *   3. Replay   — drain the degraded-mode log into the meter, idempotently.
 *   4. Hand off — give committed-but-unsettled usage to the settlement engine.
 *   5. Report   — re-measure and publish served / metered / settled, the three
 *                 deltas, and every finding.
 *
 * Measuring before repairing is deliberate. The report keeps both the
 * pre-repair deltas and the post-repair deltas, so a gap that was detected and
 * automatically closed is still visible in the audit trail instead of being
 * silently normalised away. `healthy` reflects the post-repair state — that is
 * the question an operator actually asks — while `findings` and
 * `preRepairDeltas` preserve the evidence.
 *
 * In a healthy system all three deltas are zero.
 */

import { randomUUID } from 'crypto';
import { supabase } from '../../config/database';
import logger from '../../config/logger';
import { env } from '../../config/env';
import {
  OrphanFinding,
  ReconciliationAmount,
  ReplayOutcome,
  SettlementHandoffOutcome,
  UsageDeltas,
  UsageReconciliationReport,
} from '../../types/usage-reconciliation';
import { DegradedUsageReplayService, degradedUsageReplayService } from './degraded-usage-replay';
import {
  OrphanDetectionService,
  isBillingAffecting,
  orphanDetectionService,
  sumByClass,
} from './orphan-detection';
import { SettlementHandoffService, settlementHandoffService } from './settlement-handoff';

/** Default window length when the caller does not supply one. */
const DEFAULT_WINDOW_HOURS = 24;

export interface RunOptions {
  /** End of the reconciled window. Defaults to now. */
  windowEnd?: Date;
  /** Window length in hours. Defaults to 24. */
  windowHours?: number;
  /**
   * Only measure and report. Skips replay and settlement hand-off.
   * Used for a read-only ops query.
   */
  readOnly?: boolean;
  /** Skip replay because the meter is still degraded. */
  skipReplay?: boolean;
  /** Skip the settlement hand-off because settlement is paused. */
  skipSettlementHandoff?: boolean;
}

function emptyAmount(): ReconciliationAmount {
  return { count: 0, amount: 0 };
}

function subtract(a: number, b: number): number {
  // Money is stored as numeric and surfaces through PostgREST as a number or a
  // numeric string. Normalise so a string never poisons the arithmetic.
  return round2(Number(a) - Number(b));
}

/**
 * Round to 2dp to absorb float representation noise from numeric → JS number.
 * Real usage deltas are orders of magnitude larger than this.
 */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export class UsageReconciliationService {
  constructor(
    private readonly replay: DegradedUsageReplayService = degradedUsageReplayService,
    private readonly orphans: OrphanDetectionService = orphanDetectionService,
    private readonly handoff: SettlementHandoffService = settlementHandoffService,
  ) {}

  /**
   * Run one reconciliation pass and return its report.
   *
   * Never throws: a failed run still returns a report (with `runError` set and
   * `healthy: false`) so the persisted history records the attempt.
   */
  async run(options: RunOptions = {}): Promise<UsageReconciliationReport> {
    const runId = randomUUID();
    const windowEnd = options.windowEnd ?? new Date();
    const windowHours = Number(options.windowHours ?? env.USAGE_RECONCILIATION_WINDOW_HOURS ?? DEFAULT_WINDOW_HOURS);
    const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);

    logger.info('[UsageReconciliation] Run started', {
      runId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      windowHours,
      readOnly: options.readOnly === true,
    });

    try {
      const preRepair = await this.measure(windowStart, windowEnd);

      const orphanFindings = await this.orphans.scan({ now: windowEnd });

      const replayOutcome = options.readOnly
        ? { attempted: 0, replayed: 0, replayedAmount: 0, failed: 0, abandoned: 0, alreadyApplied: 0 }
        : await this.replay.replay({ servedBefore: windowEnd, skip: options.skipReplay });

      const handoffOutcome = options.readOnly
        ? { handedOff: 0, handedOffAmount: 0, backpressured: 0, failed: 0 }
        : await this.handoff.handoffUnsettledUsage({
            now: windowEnd,
            skip: options.skipSettlementHandoff,
          });

      const postRepair = await this.measure(windowStart, windowEnd);

      const report: UsageReconciliationReport = {
        runId,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        served: postRepair.served,
        metered: postRepair.metered,
        settled: postRepair.settled,
        deltas: postRepair.deltas,
        preRepairDeltas: preRepair.deltas,
        replay: replayOutcome,
        settlementHandoff: handoffOutcome,
        orphans: orphanFindings,
        orphanBreakdown: sumByClass(orphanFindings),
        healthy: allDeltasZero(postRepair.deltas),
        runError: null,
      };

      await this.persist(report);

      logger.info('[UsageReconciliation] Run complete', {
        runId,
        healthy: report.healthy,
        served: report.served.amount,
        metered: report.metered.amount,
        settled: report.settled.amount,
        deltas: report.deltas,
        orphans: orphanFindings.length,
      });

      if (!report.healthy) {
        this.alertOnFindings(report);
      }

      return report;
    } catch (err) {
      const runError = err instanceof Error ? err.message : String(err);
      logger.error('[UsageReconciliation] Run failed', { runId, error: runError });

      const failed: UsageReconciliationReport = {
        runId,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        served: emptyAmount(),
        metered: emptyAmount(),
        settled: emptyAmount(),
        deltas: { servedMinusMetered: 0, meteredMinusSettled: 0, servedMinusSettled: 0 },
        preRepairDeltas: { servedMinusMetered: 0, meteredMinusSettled: 0, servedMinusSettled: 0 },
        replay: { attempted: 0, replayed: 0, replayedAmount: 0, failed: 0, abandoned: 0, alreadyApplied: 0 },
        settlementHandoff: { handedOff: 0, handedOffAmount: 0, backpressured: 0, failed: 0 },
        orphans: [],
        orphanBreakdown: {},
        healthy: false,
        runError,
      };

      await this.persist(failed);
      return failed;
    }
  }

  /**
   * Measure served / metered / settled over the window.
   *
   * Each figure is aggregated on its own timestamp so a piece of usage counts
   * for the window it was served in, metered in, or settled in. That keeps the
   * deltas meaningful even when replay moves a record across a window boundary.
   */
  private async measure(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{ served: ReconciliationAmount; metered: ReconciliationAmount; settled: ReconciliationAmount; deltas: UsageDeltas }> {
    const { served, metered, settled } = await this.aggregate(windowStart, windowEnd);

    return {
      served,
      metered,
      settled,
      deltas: {
        servedMinusMetered: subtract(served.amount, metered.amount),
        meteredMinusSettled: subtract(metered.amount, settled.amount),
        servedMinusSettled: subtract(served.amount, settled.amount),
      },
    };
  }

  /**
   * Partition the window's served cohort by how far it has progressed.
   *
   * All three figures are attributed to the same cohort — rows committed inside
   * the window — rather than bucketed by their own timestamp. Bucketing each
   * metric by when *that step* happened looks tempting, but it makes the report
   * structurally unable to reach zero: a repair performed during this run stamps
   * `metered_at` a moment after the window closed, so the amount just repaired
   * would still show up as an unresolved gap and `healthy` could never be true on
   * any day that actually did work.
   *
   * Attributing by `committed_at` makes the three figures nested subsets of one
   * population, so the deltas are non-negative by construction and read exactly
   * as the issue defines them: served in this window, and not yet metered;
   * metered, and not yet settled; and served, and not yet settled.
   */
  private async aggregate(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{ served: ReconciliationAmount; metered: ReconciliationAmount; settled: ReconciliationAmount }> {
    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .select('actual_amount, metered_at, settled_at')
      .not('committed_at', 'is', null)
      .gte('committed_at', windowStart.toISOString())
      .lte('committed_at', windowEnd.toISOString());

    if (error) {
      // A failed aggregate must not be reported as zero — that would show up
      // as "healthy" and hide the problem. Throw so the run is marked failed.
      throw new Error(`[UsageReconciliation] Failed to aggregate usage window: ${error.message}`);
    }

    const served = emptyAmount();
    const metered = emptyAmount();
    const settled = emptyAmount();

    for (const row of (data as Array<{ actual_amount: number | string | null; metered_at: string | null; settled_at: string | null }> | null) ?? []) {
      const amount = Number(row.actual_amount ?? 0);
      served.count += 1;
      served.amount = round2(served.amount + amount);
      if (row.metered_at) {
        metered.count += 1;
        metered.amount = round2(metered.amount + amount);
      }
      if (row.settled_at) {
        settled.count += 1;
        settled.amount = round2(settled.amount + amount);
      }
    }

    return { served, metered, settled };
  }

  /**
   * Surface billing-affecting findings. Logged rather than pushed to a
   * notification channel: the reconciliation job already dispatches its own
   * alerts, and a duplicate dispatch per finding would be noise.
   */
  private alertOnFindings(report: UsageReconciliationReport): void {
    const billingFindings = report.orphans.filter((f) => isBillingAffecting(f.orphanClass));
    const totalAtRisk = billingFindings.reduce((sum, f) => sum + f.amount, 0);

    if (billingFindings.length === 0) {
      logger.warn('[UsageReconciliation] Deltas outside the healthy state with no billing-affecting orphan', {
        runId: report.runId,
        deltas: report.deltas,
        replay: report.replay,
        settlementHandoff: report.settlementHandoff,
      });
      return;
    }

    logger.error('[UsageReconciliation] Billing-affecting usage gaps detected', {
      runId: report.runId,
      findings: billingFindings.length,
      totalAtRisk: round2(totalAtRisk),
      byClass: report.orphanBreakdown,
      deltas: report.deltas,
    });
  }

  private async persist(report: UsageReconciliationReport): Promise<void> {
    const { error } = await supabase.from('usage_reconciliation_reports').insert({
      run_id: report.runId,
      window_start: report.windowStart,
      window_end: report.windowEnd,
      served_count: report.served.count,
      served_amount: report.served.amount,
      metered_count: report.metered.count,
      metered_amount: report.metered.amount,
      settled_count: report.settled.count,
      settled_amount: report.settled.amount,
      served_minus_metered: report.deltas.servedMinusMetered,
      metered_minus_settled: report.deltas.meteredMinusSettled,
      served_minus_settled: report.deltas.servedMinusSettled,
      pre_repair_deltas: report.preRepairDeltas,
      replay_attempted_count: report.replay.attempted,
      replayed_count: report.replay.replayed,
      replayed_amount: report.replay.replayedAmount,
      replay_failed_count: report.replay.failed + report.replay.abandoned,
      handed_off_count: report.settlementHandoff.handedOff,
      handed_off_amount: report.settlementHandoff.handedOffAmount,
      repair_outcomes: {
        replay: report.replay,
        settlementHandoff: report.settlementHandoff,
      },
      orphan_total_count: report.orphans.length,
      orphan_total_amount: round2(report.orphans.reduce((sum, f) => sum + f.amount, 0)),
      orphan_breakdown: report.orphanBreakdown,
      findings: report.orphans,
      healthy: report.healthy,
      run_error: report.runError ?? null,
    });

    if (error) {
      // Surface loudly: a report that was computed but not persisted is a real
      // gap in the audit trail.
      logger.error('[UsageReconciliation] Failed to persist report', {
        runId: report.runId,
        error: error.message,
      });
    }
  }

  /**
   * Latest persisted report, for the ops dashboard and metrics route.
   */
  async getLatestReport(): Promise<UsageReconciliationReport | null> {
    const { data, error } = await supabase
      .from('usage_reconciliation_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.warn('[UsageReconciliation] Failed to read latest report', { error: error.message });
      return null;
    }
    if (!data) return null;

    // Reconstruct the full repair outcomes from the persisted object so every
    // field is real. Only fall back to the scalar columns for rows written
    // before repair_outcomes existed.
    const repairOutcomes = (data.repair_outcomes ?? {}) as {
      replay?: Partial<ReplayOutcome>;
      settlementHandoff?: Partial<SettlementHandoffOutcome>;
    };

    return {
      runId: data.run_id as string,
      windowStart: data.window_start as string,
      windowEnd: data.window_end as string,
      served: { count: data.served_count ?? 0, amount: Number(data.served_amount ?? 0) },
      metered: { count: data.metered_count ?? 0, amount: Number(data.metered_amount ?? 0) },
      settled: { count: data.settled_count ?? 0, amount: Number(data.settled_amount ?? 0) },
      deltas: {
        servedMinusMetered: Number(data.served_minus_metered ?? 0),
        meteredMinusSettled: Number(data.metered_minus_settled ?? 0),
        servedMinusSettled: Number(data.served_minus_settled ?? 0),
      },
      preRepairDeltas: (data.pre_repair_deltas as UsageDeltas) ?? {
        servedMinusMetered: 0,
        meteredMinusSettled: 0,
        servedMinusSettled: 0,
      },
      replay: {
        attempted: repairOutcomes.replay?.attempted ?? data.replay_attempted_count ?? 0,
        replayed: repairOutcomes.replay?.replayed ?? data.replayed_count ?? 0,
        replayedAmount:
          repairOutcomes.replay?.replayedAmount ?? Number(data.replayed_amount ?? 0),
        failed: repairOutcomes.replay?.failed ?? data.replay_failed_count ?? 0,
        abandoned: repairOutcomes.replay?.abandoned ?? 0,
        alreadyApplied: repairOutcomes.replay?.alreadyApplied ?? 0,
      },
      settlementHandoff: {
        handedOff:
          repairOutcomes.settlementHandoff?.handedOff ?? data.handed_off_count ?? 0,
        handedOffAmount:
          repairOutcomes.settlementHandoff?.handedOffAmount ??
          Number(data.handed_off_amount ?? 0),
        backpressured: repairOutcomes.settlementHandoff?.backpressured ?? 0,
        failed: repairOutcomes.settlementHandoff?.failed ?? 0,
      },
      orphans: (data.findings as unknown as OrphanFinding[]) ?? [],
      orphanBreakdown: (data.orphan_breakdown as Record<string, { count: number; amount: number }>) ?? {},
      healthy: data.healthy ?? false,
      runError: (data.run_error as string | null) ?? undefined,
    };
  }
}

export function allDeltasZero(deltas: UsageDeltas): boolean {
  return (
    deltas.servedMinusMetered === 0 &&
    deltas.meteredMinusSettled === 0 &&
    deltas.servedMinusSettled === 0
  );
}

export const usageReconciliationService = new UsageReconciliationService();