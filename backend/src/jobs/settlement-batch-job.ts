import cron, { type ScheduledTask } from 'node-cron';
import logger from '../config/logger';
import { runWithCorrelationId } from '../middleware/requestContext';
import { settlementBatcher } from '../services/settlement-batcher';

let settlementBatchTask: ScheduledTask | null = null;

/**
 * Periodically flush pending settlements into batched on-chain submissions.
 * Runs every 2 minutes; max wait time is enforced inside SettlementBatcher.
 */
export function startSettlementBatchJob(): void {
  settlementBatchTask = cron.schedule('*/2 * * * *', () =>
    runWithCorrelationId('cron:settlement-batch', async (cid) => {
      try {
        const result = await settlementBatcher.processPending();
        if (result.processed > 0) {
          logger.info('Settlement batch submitted', {
            correlationId: cid,
            processed: result.processed,
            batchId: result.batchId,
          });
        }
      } catch (error) {
        logger.error('Settlement batch job failed', { correlationId: cid, error });
      }
    }),
  );
  logger.info('Settlement batch cron job scheduled (every 2 minutes)');
}

export function stopSettlementBatchJob(): void {
  if (settlementBatchTask) {
    settlementBatchTask.stop();
    settlementBatchTask = null;
    logger.info('Settlement batch cron job stopped');
  }
}
