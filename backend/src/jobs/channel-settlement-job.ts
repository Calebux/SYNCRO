import cron, { type ScheduledTask } from 'node-cron';
import logger from '../config/logger';
import { env } from '../config/env';
import { runWithCorrelationId } from '../middleware/requestContext';
import { channelStateService } from '../services/channel-state';
import { paymentChannelService } from '../services/payment-channel-service';
import { settlementBatcher } from '../services/settlement-batcher';

let channelSettlementTask: ScheduledTask | null = null;

/**
 * Periodically settles accumulated channel balances on-chain per user schedule
 * (monthly or quarterly). Runs daily at 02:00 UTC.
 */
export function startChannelSettlementJob(): void {
  channelSettlementTask = cron.schedule('0 2 * * *', () =>
    runWithCorrelationId('cron:channel-settlement', async (cid) => {
      if (env.PAYMENT_CHANNELS_ENABLED !== 'true') return;

      try {
        const due = await channelStateService.getChannelsDueForSettlement();
        if (due.length === 0) return;

        for (const candidate of due) {
          try {
            await settlementBatcher.enqueue({
              userId: candidate.userId,
              subscriptionId: candidate.channelId,
              amount: candidate.executorBalance,
              settlementType: 'channel_close',
              payload: { channelId: candidate.channelId },
            });

            await paymentChannelService.initiateClose(
              candidate.userId,
              candidate.channelId,
            );
            await channelStateService.markChannelSettled(
              candidate.channelId,
              candidate.userId,
            );

            logger.info('Channel scheduled for settlement', {
              correlationId: cid,
              channelId: candidate.channelId,
              amount: candidate.executorBalance,
            });
          } catch (err) {
            logger.error('Channel settlement failed', {
              correlationId: cid,
              channelId: candidate.channelId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (error) {
        logger.error('Channel settlement job failed', { correlationId: cid, error });
      }
    }),
  );

  logger.info('Channel settlement cron job scheduled (daily 02:00 UTC)');
}

export function stopChannelSettlementJob(): void {
  if (channelSettlementTask) {
    channelSettlementTask.stop();
    channelSettlementTask = null;
    logger.info('Channel settlement cron job stopped');
  }
}
