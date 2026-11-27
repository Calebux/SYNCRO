import cron from 'node-cron';
import logger from '../config/logger';
import { usageRetentionArchiver } from '../archival/usage-retention-archiver';

export function startUsageRetentionJob(): void {
  cron.schedule('45 3 * * *', async () => {
    try {
      const archived = await usageRetentionArchiver.run();
      logger.info('Usage retention job completed', { archived });
    } catch (error) {
      logger.error('Usage retention job failed', {
        error: error instanceof Error ? error.message : String(error),
      }, { timezone: 'UTC' });
    }
  });
  logger.info('Usage retention job scheduled (daily at 03:45 UTC)');
}
