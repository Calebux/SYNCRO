import { randomUUID } from 'crypto';
import logger from '../../config/logger';
import { renewalDeadLetterService } from '../renewal-dead-letter-service';
import { renewalSagaStateService } from './renewal-saga-state-service';
import { renewalSagaStepLog } from './renewal-saga-step-log';
import { RENEWAL_SAGA_STEP_DEFINITIONS, ManualReconciliationRequiredError } from './renewal-saga-steps';
import {
  RENEWAL_SAGA_STEPS,
  RenewalSagaContext,
  RenewalSagaOutcome,
  RenewalSagaState,
  RenewalSagaStepName,
} from './renewal-saga-types';

const NON_RETRYABLE_FAILURE_MARKERS = ['invalid_approval', 'billing_window_invalid', 'Approval invalid', 'Billing window invalid'];

function buildContext(state: RenewalSagaState, extra: { approvalId: string; amount: number; lockHolder: string }): RenewalSagaContext {
  const data: Record<string, unknown> = {};
  for (const step of state.completedSteps) {
    const output = (state.stepContext as Record<string, unknown>)[`${step}_output`];
    if (output !== undefined) data[`${step}_output`] = output;
  }

  return {
    attemptId: state.attemptId,
    idempotencyKey: state.idempotencyKey,
    subscriptionId: state.subscriptionId,
    userId: state.userId,
    approvalId: extra.approvalId,
    amount: extra.amount,
    cycleId: state.cycleId,
    lockHolder: extra.lockHolder,
    data,
  };
}

export class RenewalSagaExecutor {
  /**
   * Starts (or resumes, if an attempt already exists for this idempotency
   * key) a renewal saga and drives it to completion or compensation.
   */
  async run(params: {
    subscriptionId: string;
    userId: string;
    approvalId: string;
    amount: number;
    cycleId: number;
    idempotencyKey: string;
    workerId?: string;
  }): Promise<RenewalSagaOutcome> {
    const workerId = params.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

    const initialState = await renewalSagaStateService.getOrCreate({
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      cycleId: params.cycleId,
      idempotencyKey: params.idempotencyKey,
      lockHolder: workerId,
    });

    if (initialState.sagaStatus === 'completed') {
      return { success: true, attemptId: initialState.attemptId, sagaStatus: 'completed' };
    }
    if (initialState.sagaStatus === 'dead_lettered' || initialState.sagaStatus === 'compensated') {
      return {
        success: false,
        attemptId: initialState.attemptId,
        sagaStatus: initialState.sagaStatus,
        error: 'Renewal previously failed and was compensated',
      };
    }

    return this.drive(initialState, { approvalId: params.approvalId, amount: params.amount, lockHolder: workerId });
  }

  /** Picks a saga that's already in flight back up from wherever it left off. */
  async resume(attemptId: string, params: { approvalId: string; amount: number }, workerId?: string): Promise<RenewalSagaOutcome> {
    const state = await renewalSagaStateService.getByAttemptId(attemptId);
    if (!state) {
      throw new Error(`No saga found for attemptId ${attemptId}`);
    }
    const resumedWorkerId = workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
    return this.drive(state, { approvalId: params.approvalId, amount: params.amount, lockHolder: resumedWorkerId });
  }

  private async drive(
    state: RenewalSagaState,
    extra: { approvalId: string; amount: number; lockHolder: string },
  ): Promise<RenewalSagaOutcome> {
    await renewalSagaStateService.markRunning(state.attemptId, extra.lockHolder);

    let completedSteps = [...state.completedSteps];
    let stepContext = { ...state.stepContext };

    try {
      for (const stepName of RENEWAL_SAGA_STEPS) {
        if (completedSteps.includes(stepName)) continue;

        const ctx = buildContext(
          { ...state, completedSteps, stepContext },
          extra,
        );

        const alreadyDone = await renewalSagaStepLog.hasCompleted(state.attemptId, stepName, 'execute');
        let output: Record<string, unknown> = alreadyDone ?? {};

        if (!alreadyDone) {
          const step = RENEWAL_SAGA_STEP_DEFINITIONS[stepName];
          try {
            const result = await step.execute(ctx);
            output = result?.output ?? {};
            await renewalSagaStepLog.recordCompleted(state.attemptId, stepName, 'execute', output);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await renewalSagaStepLog.recordFailed(state.attemptId, stepName, 'execute', message);
            throw Object.assign(new Error(message), { failedStep: stepName });
          }
        }

        completedSteps = [...completedSteps, stepName];
        stepContext = { ...stepContext, [`${stepName}_output`]: output };
        await renewalSagaStateService.advanceStep(state.attemptId, stepName, completedSteps, stepContext, extra.lockHolder);
      }

      await renewalSagaStateService.markCompleted(state.attemptId);

      const chargeOutput = stepContext['charge_output'] as Record<string, unknown> | undefined;
      return {
        success: true,
        attemptId: state.attemptId,
        sagaStatus: 'completed',
        transactionHash: chargeOutput?.['transactionHash'] as string | undefined,
      };
    } catch (err) {
      const failedStep = (err as { failedStep?: RenewalSagaStepName }).failedStep;
      const message = err instanceof Error ? err.message : String(err);

      logger.warn('[RenewalSaga] Step failed, compensating', {
        attemptId: state.attemptId,
        subscriptionId: state.subscriptionId,
        failedStep,
        error: message,
      });

      return this.compensate(
        { ...state, completedSteps, stepContext },
        extra,
        message,
      );
    }
  }

  private async compensate(
    state: RenewalSagaState,
    extra: { approvalId: string; amount: number; lockHolder: string },
    failureReason: string,
  ): Promise<RenewalSagaOutcome> {
    const stepsToCompensate = [...state.completedSteps].reverse();
    let needsManualReconciliation = false;

    for (const stepName of stepsToCompensate) {
      await renewalSagaStateService.markCompensating(state.attemptId, stepName, extra.lockHolder);

      const alreadyCompensated = await renewalSagaStepLog.hasCompleted(state.attemptId, stepName, 'compensate');
      if (alreadyCompensated) continue;

      const ctx = buildContext(state, extra);
      const step = RENEWAL_SAGA_STEP_DEFINITIONS[stepName];

      try {
        await step.compensate(ctx);
        await renewalSagaStepLog.recordCompleted(state.attemptId, stepName, 'compensate');
      } catch (err) {
        if (err instanceof ManualReconciliationRequiredError) {
          needsManualReconciliation = true;
          await renewalSagaStepLog.recordCompleted(state.attemptId, stepName, 'compensate', { manualReconciliation: true });
          await renewalSagaStateService.flagManualReconciliation(state.attemptId);
          continue;
        }

        const message = err instanceof Error ? err.message : String(err);
        await renewalSagaStepLog.recordFailed(state.attemptId, stepName, 'compensate', message);
        logger.error('[RenewalSaga] Compensation step failed — saga remains in compensating state for recovery to retry', {
          attemptId: state.attemptId,
          step: stepName,
          error: message,
        });
        // Leave saga in 'compensating' so the recovery job retries this
        // exact step later rather than silently giving up mid-rollback.
        return {
          success: false,
          attemptId: state.attemptId,
          sagaStatus: 'compensating',
          error: message,
          failureReason,
        };
      }
    }

    await renewalSagaStateService.markCompensated(state.attemptId);

    const isStuckReason = !NON_RETRYABLE_FAILURE_MARKERS.some((marker) => failureReason.includes(marker));
    if (isStuckReason) {
      await renewalDeadLetterService.moveToDeadLetter({
        subscriptionId: state.subscriptionId,
        userId: state.userId,
        cycleId: state.cycleId,
        idempotencyKey: state.idempotencyKey,
        approvalId: extra.approvalId,
        amount: extra.amount,
        failureReason: needsManualReconciliation ? 'needs_manual_reconciliation' : 'execution_error',
        errorMessage: failureReason,
      });
      await renewalSagaStateService.markDeadLettered(state.attemptId);
    }

    return {
      success: false,
      attemptId: state.attemptId,
      sagaStatus: 'compensated',
      error: failureReason,
      failureReason: needsManualReconciliation ? 'needs_manual_reconciliation' : 'compensated',
    };
  }
}

export const renewalSagaExecutor = new RenewalSagaExecutor();