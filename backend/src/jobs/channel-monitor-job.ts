import cron from 'node-cron';
import logger from '../config/logger';
import { runWithCorrelationId } from '../middleware/requestContext';
import { runChannelMonitor } from '../services/channel-alert-service';

/**
 * Monitors payment channels for expiry and low balance every hour.
 */
export function startChannelMonitorJob(): void {
  cron.schedule('0 * * * *', () =>
    runWithCorrelationId('cron:channel-monitor', async (cid) => {
      if (process.env.PAYMENT_CHANNELS_ENABLED !== 'true') return;

      try {
        await runChannelMonitor();
        logger.debug('Channel monitor completed', { correlationId: cid });
      } catch (error) {
        logger.error('Channel monitor job failed', { correlationId: cid, error });
      }
    }),
  );

  logger.info('Channel monitor cron job scheduled (hourly)');
}
