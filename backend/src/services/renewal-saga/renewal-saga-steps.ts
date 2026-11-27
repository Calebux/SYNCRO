import logger from '../../config/logger';
import { supabase } from '../../config/database';
import { renewalExecutor } from '../renewal-executor';
import { renewalLockService } from '../renewal-lock-service';
import { channelStateService } from '../channel-state';
import { blockchainService } from '../blockchain-service';
import { webhookService } from '../webhook-service';
import { RENEWAL_LOCK_TTL_MS } from './renewal-saga-config';
import { RenewalSagaContext, RenewalSagaStep, RenewalSagaStepResult } from './renewal-saga-types';

/**
 * Step 1 — reserve: acquire the persisted renewal lock and validate the
 * subscription is actually within its billing window. This is the saga's
 * "reservation" — nothing external has been charged yet.
 */
const reserveStep: RenewalSagaStep = {
  name: 'reserve',
  async execute(ctx): Promise<RenewalSagaStepResult> {
    const acquired = await renewalLockService.acquireLock(
      ctx.subscriptionId,
      ctx.cycleId,
      ctx.lockHolder,
      RENEWAL_LOCK_TTL_MS,
    );
    if (!acquired) {
      throw new Error('Could not acquire renewal reservation lock');
    }

    const billingWindow = await renewalExecutor.validateBillingWindow(ctx.subscriptionId);
    if (!billingWindow.valid) {
      throw new Error(billingWindow.reason ?? 'Billing window invalid');
    }

    return { output: { billingCycle: billingWindow.billingCycle ?? 'monthly' } };
  },
  async compensate(ctx): Promise<void> {
    await renewalLockService.releaseLock(ctx.subscriptionId, ctx.cycleId);
  },
};

/**
 * Step 2 — authorize_on_chain: validate and atomically consume the
 * renewal approval so no concurrent saga for this subscription/cycle can
 * spend it twice. Compensation re-opens the approval — safe because at
 * this point nothing has been charged yet.
 */
const authorizeStep: RenewalSagaStep = {
  name: 'authorize_on_chain',
  async execute(ctx): Promise<RenewalSagaStepResult> {
    const approval = await renewalExecutor.checkApproval(ctx.subscriptionId, ctx.approvalId, ctx.amount);
    if (!approval.valid) {
      throw new Error(approval.reason ?? 'Approval invalid');
    }

    const { error } = await supabase
      .from('renewal_approvals')
      .update({ used: true })
      .eq('subscription_id', ctx.subscriptionId)
      .eq('approval_id', ctx.approvalId)
      .eq('used', false);

    if (error) {
      throw new Error(`Failed to consume approval: ${error.message}`);
    }

    return { output: {} };
  },
  async compensate(ctx): Promise<void> {
    const { error } = await supabase
      .from('renewal_approvals')
      .update({ used: false })
      .eq('subscription_id', ctx.subscriptionId)
      .eq('approval_id', ctx.approvalId);

    if (error) {
      logger.error('[RenewalSaga] Failed to reopen approval during compensation', {
        subscriptionId: ctx.subscriptionId,
        approvalId: ctx.approvalId,
        error,
      });
      throw error;
    }
  },
};

/**
 * Step 3 — charge: off-chain channel payment if available, else queue a
 * batched settlement and trigger the on-chain contract renewal.
 *
 * Compensation: a channel payment can be credited straight back. An
 * on-chain contract call cannot be undone once confirmed, so compensation
 * here is "semantic" rather than a true rollback — it logs a reversal
 * event and flags the saga for manual reconciliation so ops can see it
 * instead of the money silently going nowhere.
 */
const chargeStep: RenewalSagaStep = {
  name: 'charge',
  async execute(ctx): Promise<RenewalSagaStepResult> {
    const channelResult = await renewalExecutor.tryChannelRenewal(ctx.userId, ctx.subscriptionId, ctx.amount);
    if (channelResult.used) {
      return { output: { method: 'channel', channelId: channelResult.channelId } };
    }

    const settlementId = await renewalExecutor.enqueueSettlement({
      userId: ctx.userId,
      subscriptionId: ctx.subscriptionId,
      amount: ctx.amount,
      approvalId: ctx.approvalId,
    });

    const contractResult = await renewalExecutor.triggerContractRenewal(
      ctx.subscriptionId,
      ctx.approvalId,
      ctx.amount,
    );

    if (!contractResult.success) {
      throw new Error(contractResult.error ?? 'Contract renewal failed');
    }

    return {
      output: {
        method: 'on_chain',
        settlementId,
        transactionHash: contractResult.transactionHash,
      },
    };
  },
  async compensate(ctx): Promise<void> {
    const method = ctx.data.charge_output?.['method'];

    if (method === 'channel') {
      const channelId = ctx.data.charge_output?.['channelId'] as string | undefined;
      if (!channelId) return;
      await channelStateService.reverseRenewalPayment(channelId, ctx.userId, ctx.subscriptionId, ctx.amount);
      return;
    }

    if (method === 'on_chain') {
      const transactionHash = ctx.data.charge_output?.['transactionHash'] as string | undefined;
      // The on-chain charge is already confirmed and can't be reversed by
      // this process. Log the reversal intent on-chain-adjacent (audit
      // trail) and let the recovery job flag it for manual reconciliation
      // rather than silently dropping the failure.
      await blockchainService.syncSubscription(ctx.subscriptionId, ctx.subscriptionId, 'update', {
        status: 'renewal_reversal_pending',
        amount: ctx.amount,
        reversalOfTransactionHash: transactionHash,
      });
      throw new ManualReconciliationRequiredError(
        `On-chain renewal charge (${transactionHash ?? 'unknown tx'}) needs manual refund review`,
      );
    }
  },
};

/** Thrown by a compensation step when it did its best-effort part but a human still needs to look. */
export class ManualReconciliationRequiredError extends Error {}

/**
 * Step 4 — record: extend the subscription's billing cycle. Snapshot the
 * previous values on execute so compensation can restore them exactly.
 */
const recordStep: RenewalSagaStep = {
  name: 'record',
  async execute(ctx): Promise<RenewalSagaStepResult> {
    const { data: before } = await supabase
      .from('subscriptions')
      .select('status, next_billing_date, last_renewal_date, last_transaction_hash')
      .eq('id', ctx.subscriptionId)
      .single();

    const billingCycle = (ctx.data.reserve_output?.['billingCycle'] as 'monthly' | 'quarterly' | 'yearly') ?? 'monthly';
    const transactionHash = ctx.data.charge_output?.['transactionHash'] as string | undefined;

    await renewalExecutor.updateSubscription(ctx.subscriptionId, billingCycle, transactionHash);

    return { output: { previousSubscriptionState: before ?? null } };
  },
  async compensate(ctx): Promise<void> {
    const previous = ctx.data.record_output?.['previousSubscriptionState'] as
      | { status: string; next_billing_date: string; last_renewal_date: string | null; last_transaction_hash: string | null }
      | null
      | undefined;

    if (!previous) return;

    const { error } = await supabase
      .from('subscriptions')
      .update({
        status: previous.status,
        next_billing_date: previous.next_billing_date,
        last_renewal_date: previous.last_renewal_date,
        last_transaction_hash: previous.last_transaction_hash,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ctx.subscriptionId);

    if (error) {
      logger.error('[RenewalSaga] Failed to restore subscription during compensation', {
        subscriptionId: ctx.subscriptionId,
        error,
      });
      throw error;
    }
  },
};

/**
 * Step 5 — notify: record the renewal log + fire success notifications.
 * Compensation can't unsend a notification, so it sends a corrective one.
 */
const notifyStep: RenewalSagaStep = {
  name: 'notify',
  async execute(ctx): Promise<RenewalSagaStepResult> {
    const transactionHash = ctx.data.charge_output?.['transactionHash'] as string | undefined;
    await renewalExecutor.logSuccess(ctx.subscriptionId, ctx.userId, transactionHash);
    return { output: {} };
  },
  async compensate(ctx): Promise<void> {
    try {
      webhookService.dispatchEvent(ctx.userId, 'subscription.renewal_failed', {
        subscription_id: ctx.subscriptionId,
        failure_reason: 'saga_compensated',
        error_message: 'A previously reported successful renewal was rolled back',
      });
    } catch (err) {
      logger.error('[RenewalSaga] Failed to dispatch compensating webhook', { subscriptionId: ctx.subscriptionId, err });
    }

    await supabase
      .from('renewal_logs')
      .update({ status: 'failed', failure_reason: 'saga_compensated' })
      .eq('subscription_id', ctx.subscriptionId)
      .eq('status', 'success')
      .eq('user_id', ctx.userId);
  },
};

/** Step 6 — release: release the reservation lock, closing out the saga. */
const releaseStep: RenewalSagaStep = {
  name: 'release',
  async execute(ctx): Promise<RenewalSagaStepResult> {
    await renewalLockService.releaseLock(ctx.subscriptionId, ctx.cycleId);
    return { output: {} };
  },
  async compensate(ctx): Promise<void> {
    // Nothing to undo — releasing a lock twice is a no-op, and by the time
    // release has run forward the renewal already succeeded end-to-end.
    await renewalLockService.releaseLock(ctx.subscriptionId, ctx.cycleId);
  },
};

export const RENEWAL_SAGA_STEP_DEFINITIONS: Record<string, RenewalSagaStep> = {
  reserve: reserveStep,
  authorize_on_chain: authorizeStep,
  charge: chargeStep,
  record: recordStep,
  notify: notifyStep,
  release: releaseStep,
};