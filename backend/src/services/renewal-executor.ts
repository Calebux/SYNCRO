import logger from '../config/logger';
import { supabase } from '../config/database';
import { blockchainService } from './blockchain-service';
import { DatabaseTransaction } from '../utils/transaction';
import { webhookService } from './webhook-service';

interface RenewalRequest {
  subscriptionId: string;
  userId: string;
  approvalId: string;
  amount: number;
}

interface RenewalResult {
  success: boolean;
  subscriptionId: string;
  transactionHash?: string;
  error?: string;
  failureReason?: string;
}

export class RenewalExecutor {
  async executeRenewal(request: RenewalRequest): Promise<RenewalResult> {
    const { subscriptionId, userId, approvalId, amount } = request;

    return await DatabaseTransaction.execute(async (client) => {
      try {
        // Step 1: Check approval
        const approval = await this.checkApproval(client, subscriptionId, approvalId, amount);
        if (!approval.valid) {
          return this.logFailure(subscriptionId, userId, 'invalid_approval', approval.reason);
        }

        // Step 2: Validate billing window
        const billingWindow = await this.validateBillingWindow(client, subscriptionId);
        if (!billingWindow.valid) {
          return this.logFailure(subscriptionId, userId, 'billing_window_invalid', billingWindow.reason);
        }

        // Step 3: Trigger contract renewal
        const contractResult = await this.triggerContractRenewal(
          subscriptionId,
          approvalId,
          amount
        );

        if (!contractResult.success) {
          return this.logFailure(subscriptionId, userId, 'contract_failure', contractResult.error);
        }

        // Step 4: Update DB
        await this.updateSubscription(client, subscriptionId, contractResult.transactionHash);

        // Step 5: Log result
        await this.logSuccess(client, subscriptionId, userId, contractResult.transactionHash);

        return {
          success: true,
          subscriptionId,
          transactionHash: contractResult.transactionHash,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('Renewal execution failed:', { subscriptionId, error: errorMsg });
        return this.logFailure(subscriptionId, userId, 'execution_error', errorMsg);
      }
    });
  }

  async executeRenewalWithRetry(request: RenewalRequest, maxRetries = 3): Promise<RenewalResult> {
    let lastResult: RenewalResult | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info(`Renewal attempt ${attempt}/${maxRetries}`, { subscriptionId: request.subscriptionId });

      lastResult = await this.executeRenewal(request);

      if (lastResult.success) {
        return lastResult;
      }

      if (this.isRetryable(lastResult.failureReason)) {
        const delay = this.calculateBackoff(attempt);
        await this.sleep(delay);
      } else {
        break;
      }
    }

    return lastResult!;
  }

  private async checkApproval(
    client: any,
    subscriptionId: string,
    approvalId: string,
    amount: number
  ): Promise<{ valid: boolean; reason?: string }> {
    const { data: approval, error } = await client
      .from('renewal_approvals')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .eq('approval_id', approvalId)
      .eq('used', false)
      .single();

    if (error || !approval) {
      return { valid: false, reason: 'Approval not found' };
    }

    if (approval.expires_at && new Date(approval.expires_at) < new Date()) {
      return { valid: false, reason: 'Approval expired' };
    }

    if (approval.max_spend && amount > approval.max_spend) {
      return { valid: false, reason: 'Amount exceeds max spend' };
    }

    return { valid: true };
  }

  private async validateBillingWindow(
    client: any,
    subscriptionId: string
  ): Promise<{ valid: boolean; reason?: string }> {
    const { data: subscription, error } = await client
      .from('subscriptions')
      .select('next_billing_date, status')
      .eq('id', subscriptionId)
      .single();

    if (error || !subscription) {
      return { valid: false, reason: 'Subscription not found' };
    }

    if (subscription.status !== 'active') {
      return { valid: false, reason: 'Subscription not active' };
    }

    const nextBilling = new Date(subscription.next_billing_date);
    const now = new Date();
    const daysUntilBilling = Math.ceil((nextBilling.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilBilling > 7) {
      return { valid: false, reason: 'Too early for renewal' };
    }

    return { valid: true };
  }

  private async triggerContractRenewal(
    subscriptionId: string,
    approvalId: string,
    amount: number
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // TODO: Implement actual Soroban contract call
      // For now, simulate contract interaction
      const result = await blockchainService.syncSubscription(
        subscriptionId,
        subscriptionId,
        'update',
        { status: 'renewed', amount }
      );

      return {
        success: result.success,
        transactionHash: result.transactionHash,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async updateSubscription(
    client: any,
    subscriptionId: string,
    transactionHash?: string
  ): Promise<void> {
    const now = new Date();
    const nextBilling = new Date(now);
    nextBilling.setMonth(nextBilling.getMonth() + 1);

    await client
      .from('subscriptions')
      .update({
        status: 'active',
        next_billing_date: nextBilling.toISOString(),
        last_renewal_date: now.toISOString(),
        last_transaction_hash: transactionHash,
        updated_at: now.toISOString(),
      })
      .eq('id', subscriptionId);
  }

  private async logSuccess(
    client: any,
    subscriptionId: string,
    userId: string,
    transactionHash?: string
  ): Promise<void> {
    await client.from('renewal_logs').insert({
      subscription_id: subscriptionId,
      user_id: userId,
      status: 'success',
      transaction_hash: transactionHash,
      created_at: new Date().toISOString(),
    });

    logger.info('Renewal executed successfully', { subscriptionId, transactionHash });

    // Dispatch webhook event
    webhookService.dispatchEvent(userId, 'subscription.renewed', {
      subscription_id: subscriptionId,
      transaction_hash: transactionHash
    }).catch(err => {
      logger.error('Failed to dispatch subscription.renewed webhook:', err);
    });
  }

  private async logFailure(
    subscriptionId: string,
    userId: string,
    failureReason: string,
    errorMessage?: string
  ): Promise<RenewalResult> {
    await supabase.from('renewal_logs').insert({
      subscription_id: subscriptionId,
      user_id: userId,
      status: 'failed',
      failure_reason: failureReason,
      error_message: errorMessage,
      created_at: new Date().toISOString(),
    });

    logger.error('Renewal failed', { subscriptionId, failureReason, errorMessage });

    // Dispatch webhook event
    webhookService.dispatchEvent(userId, 'subscription.renewal_failed', {
      subscription_id: subscriptionId,
      failure_reason: failureReason,
      error_message: errorMessage
    }).catch(err => {
      logger.error('Failed to dispatch subscription.renewal_failed webhook:', err);
    });

    return {
      success: false,
      subscriptionId,
      failureReason,
      error: errorMessage,
    };
  }

  private isRetryable(reason?: string): boolean {
    const retryableReasons = ['contract_failure', 'execution_error'];
    return reason ? retryableReasons.includes(reason) : false;
  }

  private calculateBackoff(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const renewalExecutor = new RenewalExecutor();
