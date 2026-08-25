import cron from 'node-cron';
import logger from '../config/logger';
import { runWithCorrelationId } from '../middleware/requestContext';
import { runChannelMonitor } from '../services/channel-alert-service';
import { channelStateService } from '../services/channel-state';

/**
 * Monitors payment channels for expiry, low balance, and watchtower dispute
 * submissions every hour.
 */
export function startChannelMonitorJob(): void {
  cron.schedule('0 * * * *', () =>
    runWithCorrelationId('cron:channel-monitor', async (cid) => {
      if (process.env.PAYMENT_CHANNELS_ENABLED !== 'true') return;

      try {
        await runChannelMonitor();
        await runWatchtowerSweep();
        logger.debug('Channel monitor completed', { correlationId: cid });
      } catch (error) {
        logger.error('Channel monitor job failed', { correlationId: cid, error });
      }
    }),
  );

  logger.info('Channel monitor cron job scheduled (hourly)');
}

/**
 * For channels in the dispute window with a registered watchtower, submit the
 * locally known newer signed state on the user's behalf.
 */
export async function runWatchtowerSweep(): Promise<void> {
  const candidates = await channelStateService.getChannelsNeedingWatchtower();
  for (const { channel, watchtowers } of candidates) {
    const tower = watchtowers[0];
    if (!tower) continue;
    const seq = channel.channelState?.sequenceNumber ?? 0;
    try {
      await channelStateService.submitWatchtowerState({
        channelId: channel.id,
        userId: channel.userId,
        watchtower: tower.address,
        balanceA: channel.channelState?.userBalance ?? Number.parseFloat(channel.balance),
        balanceB: channel.channelState?.executorBalance ?? 0,
        sequenceNumber: seq + 1,
      });
      logger.info('Watchtower sweep submitted newer state', {
        channelId: channel.id,
        watchtower: tower.address,
      });
    } catch (error) {
      logger.warn('Watchtower sweep skipped channel', {
        channelId: channel.id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
