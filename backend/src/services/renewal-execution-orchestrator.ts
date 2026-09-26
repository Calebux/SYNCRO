import { randomUUID } from 'crypto';
import logger from '../config/logger';
import { supabase } from '../config/database';
import { redisDistributedLock } from '../lib/redis-lock';
import { renewalExecutor } from './renewal-executor';
import { renewalDeadLetterService } from './renewal-dead-letter-service';
import { generateCycleId } from '../utils/cycle-id';
import { idempotencyService } from './idempotency';
import { renewalSagaExecutor } from './renewal-saga/renewal-saga-executor';

export interface RenewalExecutionRequest {
  subscriptionId: string;
  userId: string;
  approvalId: string;
  amount: number;
  billingDate?: Date | string;
}

export interface RenewalExecutionResponse {
  success: boolean;
  subscriptionId: string;
  idempotencyKey: string;
  cycleId: number;
  transactionHash?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
  failureReason?: string;
}

/**
 * Orchestrates idempotent renewal execution with Redis distributed locks.
 */
export class RenewalExecutionOrchestrator {
  private readonly lockHolder = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

  async executeIdempotentRenewal(request: RenewalExecutionRequest): Promise<RenewalExecutionResponse> {
    const { subscriptionId, userId, approvalId, amount } = request;

    const billingDate = request.billingDate ?? (await this.resolveBillingDate(subscriptionId));
    const cycleId = generateCycleId(billingDate);
    const idempotencyKey = idempotencyService.generateKey(userId, `renewal:${subscriptionId}:${cycleId}`, {
      subscriptionId,
      approvalId,
      amount,
      cycleId,
    });

    const existingAttempt = await renewalDeadLetterService.getAttemptByKey(idempotencyKey);
    if (existingAttempt?.status === 'success' && existingAttempt.result) {
      logger.info('[RenewalOrchestrator] Idempotent hit — returning cached result', {
        subscriptionId,
        cycleId,
        idempotencyKey,
      });
      const cached = existingAttempt.result as RenewalExecutionResponse;
      return { ...cached, skipped: true, reason: 'already_processed' };
    }

    const lockResult = await redisDistributedLock.acquire(subscriptionId, cycleId);
    if (!lockResult.acquired) {
      if (lockResult.reason === 'contention') {
        logger.info('[RenewalOrchestrator] Lock contention — skipping duplicate renewal', {
          subscriptionId,
          cycleId,
        });
        return {
          success: false,
          subscriptionId,
          idempotencyKey,
          cycleId,
          skipped: true,
          reason: 'lock_contention',
          error: 'Another worker is processing this renewal',
        };
      }

      logger.warn('[RenewalOrchestrator] Redis unavailable — proceeding without lock', {
        subscriptionId,
        cycleId,
      });
    }

    const lockToken = lockResult.lockToken;

   try {
      const outcome = await renewalSagaExecutor.run({
        subscriptionId,
        userId,
        approvalId,
        amount,
        cycleId,
         idempotencyKey,
        workerId: this.lockHolder,
      });

      const response: RenewalExecutionResponse = {
        success: outcome.success,
        subscriptionId,
        idempotencyKey,
        cycleId,
        transactionHash: outcome.transactionHash,
        error: outcome.error,
        failureReason: outcome.failureReason,
      };

      if (outcome.success) {
        const requestHash = idempotencyService.hashRequest({ subscriptionId, approvalId, amount, cycleId });
        await idempotencyService.storeResponse(idempotencyKey, userId, requestHash, 200, response);
      }

      return response;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('[RenewalOrchestrator] Unexpected saga error', { subscriptionId, error: errorMsg });

      return {
        success: false,
        subscriptionId,
        idempotencyKey,
        cycleId,
        error: errorMsg,
        failureReason: 'execution_error',
      };
    } finally {
      if (lockToken) {
        await redisDistributedLock.release(subscriptionId, cycleId, lockToken);
      }
    }
  }
    private async resolveBillingDate(subscriptionId: string): Promise<string> {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('next_billing_date')
      .eq('id', subscriptionId)
      .single();

    if (error || !data?.next_billing_date) {
      return new Date().toISOString();
    }

    return data.next_billing_date;
  }
}

export const renewalExecutionOrchestrator = new RenewalExecutionOrchestrator();
