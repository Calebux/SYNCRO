/**
 * backend/src/jobs/usage-reconciliation-job.ts
 *
 * Daily reconciliation of usage that was served but not correctly accounted
 * for — issue #1445.
 *
 * Schedule: 04:10 UTC daily. Deliberately offset from the other 03:00 jobs
 * (`settlement-reconciliation-job`, `channel-settlement-job` territory) so this
 * run measures a settled system rather than competing with jobs that are still
 * writing to it.
 *
 * Ordering rationale for 04:10:
 *   - after channel settlement (02:00), so settled usage is already in the
 *     channel state this job compares against;
 *   - after settlement batching, so anything about to be settled has been;
 *   - off the :00 hour to avoid the thundering herd every other cron job in
 *     this service lands on.
 */

import cron, { type ScheduledTask } from 'node-cron';
import logger from '../config/logger';
import { env } from '../config/env';
import { runWithCorrelationId } from '../middleware/requestContext';
import {
  usageReconciliationService,
  allDeltasZero,
} from '../services/usage/usage-reconciliation';
import { redisStoreInstance } from '../lib/redis-store';

let usageReconciliationTask: ScheduledTask | null = null;

/** Default cron: 04:10 UTC daily. */
export const DEFAULT_USAGE_RECONCILIATION_CRON = '10 4 * * *';

export function startUsageReconciliationJob(): void {
  if (env.USAGE_RECONCILIATION_ENABLED === 'false') {
    logger.info('[UsageReconciliation] Job disabled via USAGE_RECONCILIATION_ENABLED=false');
    return;
  }

  const schedule = env.USAGE_RECONCILIATION_CRON || DEFAULT_USAGE_RECONCILIATION_CRON;

  usageReconciliationTask = cron.schedule(schedule, () =>
    runWithCorrelationId('cron:usage-reconciliation', async (cid) => {
      // When the meter is degraded, the report would measure a system that
      // cannot record what it is doing. Skip rather than publish a misleading
      // healthy run — and say so, so a skipped day is never mistaken for a
      // clean one.
      const meterDegraded = redisStoreInstance.isDegraded();
      if (meterDegraded) {
        logger.warn(
          '[UsageReconciliation] Skipping run — meter store is degraded, report would not be meaningful',
          { correlationId: cid },
        );
        return;
      }

      try {
        const report = await usageReconciliationService.run({
          windowHours: Number(env.USAGE_RECONCILIATION_WINDOW_HOURS ?? 24),
        });

        if (report.runError) {
          logger.error('[UsageReconciliation] Run completed with an error', {
            correlationId: cid,
            runId: report.runId,
            error: report.runError,
          });
          return;
        }

        logger.info('[UsageReconciliation] Daily report', {
          correlationId: cid,
          runId: report.runId,
          windowStart: report.windowStart,
          windowEnd: report.windowEnd,
          served: report.served,
          metered: report.metered,
          settled: report.settled,
          deltas: report.deltas,
          preRepairDeltas: report.preRepairDeltas,
          replay: report.replay,
          settlementHandoff: report.settlementHandoff,
          orphanCount: report.orphans.length,
          orphanBreakdown: report.orphanBreakdown,
          healthy: report.healthy,
        });

        if (!report.healthy && allDeltasZero(report.preRepairDeltas)) {
          // Deltas were non-zero before repair and are zero after: the job
          // closed a real gap on its own. Worth a distinct log line so it is
          // visible that repair actually happened.
          logger.warn(
            '[UsageReconciliation] Gaps detected and auto-repaired this run',
            { correlationId: cid, runId: report.runId },
          );
        }
      } catch (err) {
        logger.error('[UsageReconciliation] Cron handler threw', {
          correlationId: cid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  logger.info(`[UsageReconciliation] Cron scheduled (${schedule})`);
}

export function stopUsageReconciliationJob(): void {
  if (usageReconciliationTask) {
    usageReconciliationTask.stop();
    usageReconciliationTask = null;
    logger.info('[UsageReconciliation] Cron stopped');
  }
}

/**
 * Run the reconciliation immediately, outside the schedule.
 *
 * Used by the ops route so an operator can reconcile on demand and by tests
 * that need a deterministic trigger.
 */
export async function runUsageReconciliationNow(): Promise<
  Awaited<ReturnType<typeof usageReconciliationService.run>>
> {
  return usageReconciliationService.run({
    windowHours: Number(env.USAGE_RECONCILIATION_WINDOW_HOURS ?? 24),
  });
}