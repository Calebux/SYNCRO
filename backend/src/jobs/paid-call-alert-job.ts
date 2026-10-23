/**
 * Paid-Call Alert Job
 *
 * Periodically checks money-related metrics (unsettled value, reconciliation delta)
 * and routes alerts to a human via Slack when thresholds are exceeded.
 *
 * Runs every 5 minutes.
 */

import cron, { type ScheduledTask } from 'node-cron';
import logger from '../config/logger';
import { runWithCorrelationId } from '../middleware/requestContext';
import { paidCallAlertService } from '../services/paid-call-alert-service';
import { sliMetricsService } from '../services/sli-metrics-service';
import { env } from '../config/env';

let paidCallAlertTask: ScheduledTask | null = null;

export function startPaidCallAlertJob(): void {
  if (env.PAID_CALL_ALERTS_ENABLED === 'false') {
    logger.info('[PaidCallAlert] Job disabled via PAID_CALL_ALERTS_ENABLED=false');
    return;
  }

  paidCallAlertTask = cron.schedule('*/5 * * * *', () =>
    runWithCorrelationId('cron:paid-call-alerts', async () => {
      try {
        const sli = await sliMetricsService.getSliMetrics();
        const paidCall = sli.paid_call_metrics;

        // Check unsettled value per channel
        await paidCallAlertService.checkUnsettledValue(paidCall.unsettled_value_per_channel);

        // Check reconciliation delta
        await paidCallAlertService.checkReconciliationDelta({
          totalDelta: paidCall.reconciliation_delta.totalDelta,
          channelsOutOfTolerance: paidCall.reconciliation_delta.channelsOutOfTolerance,
          blocked: paidCall.reconciliation_delta.blocked,
          runId: `reconciliation-${new Date().toISOString()}`,
          deltasByCause: paidCall.reconciliation_delta.deltasByCause,
        });

        // Check meter reserve failures
        await paidCallAlertService.checkMeterReserveFailures(
          paidCall.meter_reserve_and_commit.reserveFailures,
        );

        // Check meter commit failures
        await paidCallAlertService.checkMeterCommitFailures(
          paidCall.meter_reserve_and_commit.commitFailures,
        );

        // Check settlement submission success rate
        await paidCallAlertService.checkSettlementSubmission(
          paidCall.settlement_submission.submissionSuccessRatePct,
        );

        // Check indexer lag
        await paidCallAlertService.checkIndexerLag(
          paidCall.indexer_lag_ms.lagBlocks,
          paidCall.indexer_lag_ms.lagMs,
        );

        logger.debug('[PaidCallAlert] Check completed', {
          unsettledChannels: paidCall.unsettled_value_per_channel.length,
          channelsOutOfTolerance: paidCall.reconciliation_delta.channelsOutOfTolerance,
          blocked: paidCall.reconciliation_delta.blocked,
        });
      } catch (error) {
        logger.error('[PaidCallAlert] Check failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  paidCallAlertTask.start();
  logger.info('[PaidCallAlert] Job started (every 5 minutes)');
}

export function stopPaidCallAlertJob(): void {
  if (paidCallAlertTask) {
    paidCallAlertTask.stop();
    paidCallAlertTask = null;
    logger.info('[PaidCallAlert] Job stopped');
  }
}
