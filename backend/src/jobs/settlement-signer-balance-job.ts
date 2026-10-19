import cron, { type ScheduledTask } from 'node-cron';
import logger from '../config/logger';
import { env } from '../config/env';
import { runWithCorrelationId } from '../middleware/requestContext';
import { settlementSignerBalanceService } from '../services/settlement-signer-balance-service';
import * as Sentry from '@sentry/node';

let settlementSignerBalanceTask: ScheduledTask | null = null;

/**
 * Periodically checks the settlement signer's XLM balance and emits
 * Sentry alerts when the balance crosses warning / critical thresholds.
 *
 * The check runs on the schedule defined by
 * `SETTLEMENT_SIGNER_BALANCE_CHECK_CRON` (default: every 15 minutes).
 */
export function startSettlementSignerBalanceJob(): void {
  if (!env.SETTLEMENT_SIGNER_SECRET_KEY) {
    logger.info('[SettlementSignerBalance] Job disabled — SETTLEMENT_SIGNER_SECRET_KEY not set');
    return;
  }

  settlementSignerBalanceTask = cron.schedule(env.SETTLEMENT_SIGNER_BALANCE_CHECK_CRON, () =>
    runWithCorrelationId('cron:settlement-signer-balance', async (cid) => {
      try {
        const result = await settlementSignerBalanceService.getSignerBalance();

        if (result.balance === null) {
          logger.warn('[SettlementSignerBalance] Could not fetch balance (account not found or network error)', {
            correlationId: cid,
            accountId: result.accountId,
          });
          return;
        }

        // Export the metric via Sentry gauge
        Sentry.metrics.gauge('settlement_signer_balance', result.balance, {
          tags: { accountId: result.accountId },
        });

        const warningThreshold = parseFloat(env.SETTLEMENT_SIGNER_BALANCE_WARNING_THRESHOLD);
        const criticalThreshold = parseFloat(env.SETTLEMENT_SIGNER_BALANCE_CRITICAL_THRESHOLD);

        if (result.balance <= criticalThreshold) {
          Sentry.captureMessage(
            `[SettlementSignerBalance] CRITICAL: Settlement signer XLM balance is ${result.balance} XLM (threshold: ${criticalThreshold} XLM). Refill immediately to avoid settlement failures.`,
            {
              level: 'critical',
              tags: { alertClass: 'settlement-signer-balance' },
              extra: { balance: result.balance, threshold: criticalThreshold, accountId: result.accountId },
            },
          );
        } else if (result.balance <= warningThreshold) {
          Sentry.captureMessage(
            `[SettlementSignerBalance] WARNING: Settlement signer XLM balance is ${result.balance} XLM (threshold: ${warningThreshold} XLM). Consider refilling soon.`,
            {
              level: 'warning',
              tags: { alertClass: 'settlement-signer-balance' },
              extra: { balance: result.balance, threshold: warningThreshold, accountId: result.accountId },
            },
          );
        } else {
          logger.info('[SettlementSignerBalance] Balance check OK', {
            correlationId: cid,
            balance: result.balance,
            accountId: result.accountId,
          });
        }
      } catch (error) {
        logger.error('[SettlementSignerBalance] Job failed:', { error, correlationId: cid });
      }
    }),
  );

  logger.info('[SettlementSignerBalance] Job started', {
    cron: env.SETTLEMENT_SIGNER_BALANCE_CHECK_CRON,
    warningThreshold: env.SETTLEMENT_SIGNER_BALANCE_WARNING_THRESHOLD,
    criticalThreshold: env.SETTLEMENT_SIGNER_BALANCE_CRITICAL_THRESHOLD,
  });
}

export function stopSettlementSignerBalanceJob(): void {
  if (settlementSignerBalanceTask) {
    settlementSignerBalanceTask.stop();
    settlementSignerBalanceTask = null;
    logger.info('[SettlementSignerBalance] Job stopped');
  }
}
