import { randomUUID } from 'crypto';
import logger from '../config/logger';
import { supabase } from '../config/database';
import { redisDistributedLock } from '../lib/redis-lock';
import { renewalExecutor } from './renewal-executor';
import { renewalDeadLetterService } from './renewal-dead-letter-service';
import { generateCycleId } from '../utils/cycle-id';
import { idempotencyService } from './idempotency';

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
      await renewalDeadLetterService.recordAttempt({
        subscriptionId,
        userId,
        cycleId,
        idempotencyKey,
        lockHolder: this.lockHolder,
      });

      const result = await renewalExecutor.executeRenewal({
        subscriptionId,
        userId,
        approvalId,
        amount,
      });

      const response: RenewalExecutionResponse = {
        success: result.success,
        subscriptionId,
        idempotencyKey,
        cycleId,
        transactionHash: result.transactionHash,
        error: result.error,
        failureReason: result.failureReason,
      };

      if (result.success) {
        await renewalDeadLetterService.updateAttemptStatus(idempotencyKey, 'success', response);

        const requestHash = idempotencyService.hashRequest({ subscriptionId, approvalId, amount, cycleId });
        await idempotencyService.storeResponse(idempotencyKey, userId, requestHash, 200, response);
      } else {
        await renewalDeadLetterService.updateAttemptStatus(idempotencyKey, 'failed', response);

        const isStuck = ['execution_error', 'contract_failure'].includes(result.failureReason ?? '');
        if (isStuck) {
          await renewalDeadLetterService.moveToDeadLetter({
            subscriptionId,
            userId,
            cycleId,
            idempotencyKey,
            approvalId,
            amount,
            failureReason: result.failureReason ?? 'unknown',
            errorMessage: result.error,
          });
        }
      }

      return response;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('[RenewalOrchestrator] Unexpected error', { subscriptionId, error: errorMsg });

      await renewalDeadLetterService.updateAttemptStatus(idempotencyKey, 'failed', { error: errorMsg });
      await renewalDeadLetterService.moveToDeadLetter({
        subscriptionId,
        userId,
        cycleId,
        idempotencyKey,
        approvalId,
        amount,
        failureReason: 'execution_error',
        errorMessage: errorMsg,
      });

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
