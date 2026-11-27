import cron, { type ScheduledTask } from 'node-cron';
import logger from '../config/logger';
import { env } from '../config/env';
import { runWithCorrelationId } from '../middleware/requestContext';
import { settlementReconciliationService } from '../services/settlement-reconciliation-service';
import { settlementBatcher } from '../services/settlement-batcher';

let reconciliationTask: ScheduledTask | null = null;

/**
 * Daily three-way reconciliation between the meter, settlement engine, and chain.
 *
 * Runs at 03:00 UTC (after the 02:00 channel settlement job).
 * On any out-of-tolerance delta the next settlement batch is blocked until the
 * run is clean — call settlementReconciliationService.unblock() after a
 * manual investigation confirms the discrepancy is resolved.
 */
export function startSettlementReconciliationJob(): void {
  if (env.SETTLEMENT_RECONCILIATION_ENABLED === 'false') {
    logger.info('[SettlementReconciliation] Job disabled via SETTLEMENT_RECONCILIATION_ENABLED=false');
    return;
  }

  reconciliationTask = cron.schedule('0 3 * * *', () =>
    runWithCorrelationId('cron:settlement-reconciliation', async (cid) => {
      logger.info('[SettlementReconciliation] Cron tick — starting daily run', { correlationId: cid });

      // If a previous run already blocked the batch, skip until manually unblocked.
      if (settlementReconciliationService.isBlocked()) {
        logger.warn(
          '[SettlementReconciliation] Settlement batch is BLOCKED from a previous run — ' +
          'investigate and call settlementReconciliationService.unblock() to resume.',
          { correlationId: cid },
        );
        return;
      }

      try {
        const result = await settlementReconciliationService.run();

        if (result.runError) {
          logger.error('[SettlementReconciliation] Run completed with error', {
            correlationId: cid,
            runId: result.runId,
            error: result.runError,
          });
          return;
        }

        logger.info('[SettlementReconciliation] Run completed', {
          correlationId: cid,
          runId: result.runId,
          totalChannels: result.totalChannels,
          channelsOutOfTolerance: result.channelsOutOfTolerance,
          blocked: result.blocked,
          deltasByCause: result.deltasByCause,
        });

        if (result.blocked) {
          logger.warn(
            '[SettlementReconciliation] Settlement batching PAUSED — ' +
            `${result.channelsOutOfTolerance}/${result.totalChannels} channels outside tolerance. ` +
            'Operators have been notified. Settlement will resume once the reconciliation is clean.',
            { correlationId: cid, runId: result.runId },
          );
          // Monkey-patch the batcher's processPending to no-op while blocked.
          // The original is restored when unblock() is called.
          _installBatchGuard();
        }
      } catch (err) {
        logger.error('[SettlementReconciliation] Cron handler threw', {
          correlationId: cid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  logger.info('[SettlementReconciliation] Cron scheduled (daily 03:00 UTC)');
}

export function stopSettlementReconciliationJob(): void {
  if (reconciliationTask) {
    reconciliationTask.stop();
    reconciliationTask = null;
    logger.info('[SettlementReconciliation] Cron stopped');
  }
}

// ─── Settlement batch guard ───────────────────────────────────────────────────
// When the reconciliation job finds a delta outside tolerance it wraps
// SettlementBatcher.processPending so every call returns immediately with a
// 'reconciliation_blocked' skip reason until the operator calls unblock().

let _originalProcessPending: typeof settlementBatcher.processPending | null = null;

function _installBatchGuard(): void {
  if (_originalProcessPending) return; // already installed

  _originalProcessPending = settlementBatcher.processPending.bind(settlementBatcher);

  (settlementBatcher as any).processPending = async (): Promise<{
    processed: number;
    skipped?: string;
  }> => {
    if (settlementReconciliationService.isBlocked()) {
      logger.warn(
        '[SettlementReconciliation] processPending blocked — reconciliation delta outside tolerance. ' +
        'Resolve discrepancy then call settlementReconciliationService.unblock().',
      );
      return { processed: 0, skipped: 'reconciliation_blocked' };
    }
    // Tolerance cleared — restore and call through
    _removeBatchGuard();
    return _originalProcessPending!();
  };

  logger.warn('[SettlementReconciliation] Settlement batch guard installed');
}

function _removeBatchGuard(): void {
  if (_originalProcessPending) {
    (settlementBatcher as any).processPending = _originalProcessPending;
    _originalProcessPending = null;
    logger.info('[SettlementReconciliation] Settlement batch guard removed');
  }
}
