import logger from '../../config/logger';
import { supabase } from '../../config/database';
import { renewalSagaStateService } from './renewal-saga-state-service';
import { renewalSagaExecutor } from './renewal-saga-executor';
import { RENEWAL_SAGA_STUCK_THRESHOLD_MS } from './renewal-saga-config';

/**
 * Run on a schedule (cron/interval, same place `scheduler.ts` runs
 * `renewalLockService.releaseExpiredLocks`). Picks up any saga whose
 * `step_started_at` heartbeat is older than the stuck threshold — i.e. a
 * worker died mid-step — and resumes it. The saga executor's step-log
 * idempotency guarantees this never double-executes or double-charges.
 */
export class RenewalSagaRecoveryService {
  async recoverStuckSagas(): Promise<{ recovered: number; failed: number }> {
    const stuck = await renewalSagaStateService.getStuckSagas(RENEWAL_SAGA_STUCK_THRESHOLD_MS);

    if (stuck.length === 0) {
      return { recovered: 0, failed: 0 };
    }

    logger.warn('[RenewalSagaRecovery] Found stuck sagas', { count: stuck.length });

    let recovered = 0;
    let failed = 0;

    for (const saga of stuck) {
      try {
        const { data: approval } = await supabase
          .from('renewal_approvals')
          .select('approval_id')
          .eq('subscription_id', saga.subscriptionId)
          .limit(1)
          .maybeSingle();

        const { data: dlq } = await supabase
          .from('renewal_dead_letter_queue')
          .select('approval_id, amount')
          .eq('idempotency_key', saga.idempotencyKey)
          .maybeSingle();

        const approvalId = (dlq?.approval_id as string | undefined) ?? approval?.approval_id ?? '';
        const amount = (dlq?.amount as number | undefined) ?? 0;

        const outcome = await renewalSagaExecutor.resume(saga.attemptId, { approvalId, amount });

        logger.info('[RenewalSagaRecovery] Resumed saga', {
          attemptId: saga.attemptId,
          subscriptionId: saga.subscriptionId,
          outcome: outcome.sagaStatus,
        });
        recovered += 1;
      } catch (err) {
        failed += 1;
        logger.error('[RenewalSagaRecovery] Failed to recover saga', {
          attemptId: saga.attemptId,
          subscriptionId: saga.subscriptionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { recovered, failed };
  }
}

export const renewalSagaRecoveryService = new RenewalSagaRecoveryService();