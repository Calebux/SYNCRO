import cron from 'node-cron';
import logger from '../config/logger';
import { env } from '../config/env';
import { supabase } from '../config/database';
import { runWithCorrelationId } from '../middleware/requestContext';
import { stealthScanner } from '../services/stealth-scanner';

/**
 * Scans Stellar ledger for incoming stealth payments.
 * Runs every minute to meet the <1 minute detection SLA.
 */
export function startStealthScanJob(): void {
  if (env.STEALTH_SCANNER_ENABLED !== 'true') {
    logger.info('Stealth scan job disabled (STEALTH_SCANNER_ENABLED != true)');
    return;
  }

  cron.schedule('* * * * *', () =>
    runWithCorrelationId('cron:stealth-scan', async (cid) => {
      try {
        const { data: users } = await supabase
          .from('profiles')
          .select('id')
          .not('stealth_meta_address', 'is', null);

        let totalDetected = 0;
        for (const user of users ?? []) {
          try {
            const result = await stealthScanner.scanLedgerForUser(user.id);
            totalDetected += result.detected;
          } catch (err) {
            logger.warn('Stealth scan failed for user', {
              correlationId: cid,
              userId: user.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (totalDetected > 0) {
          logger.info('Stealth scan cycle complete', {
            correlationId: cid,
            detected: totalDetected,
          });
        }
      } catch (error) {
        logger.error('Stealth scan job failed', { correlationId: cid, error });
      }
    }),
  );

  logger.info('Stealth scan cron job scheduled (every minute)');
}
