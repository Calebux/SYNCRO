import logger from '../config/logger';
import { supabase } from '../config/database';
import { blockchainService } from './blockchain-service';
import { webhookService } from './webhook-service';
import { channelStateService } from './channel-state';
import { settlementBatcher } from './settlement-batcher';
import { addMonths, addQuarters, addYears } from 'date-fns';
import { deriveEphemeralStealthAddress } from '@syncro/shared/crypto';
import { getRequestId } from '../middleware/requestContext';

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
  private readonly supabase: typeof supabase;
  private readonly logger: typeof logger;
  private readonly blockchainService: typeof blockchainService;
  private readonly webhookService: typeof webhookService;
  private readonly channelStateService: typeof channelStateService;
  private readonly settlementBatcher: typeof settlementBatcher;
  private readonly stealthScanner: any;
  private readonly clock: import('./clock').Clock;

  constructor(options: Partial<{
    supabase: typeof supabase;
    logger: typeof logger;
    blockchainService: typeof blockchainService;
    webhookService: typeof webhookService;
    channelStateService: typeof channelStateService;
    settlementBatcher: typeof settlementBatcher;
    stealthScanner: any;
    clock: import('./clock').Clock;
  }> = {}) {
    this.supabase = options.supabase ?? supabase;
    this.logger = options.logger ?? logger;
    this.blockchainService = options.blockchainService ?? blockchainService;
    this.webhookService = options.webhookService ?? webhookService;
    this.channelStateService = options.channelStateService ?? channelStateService;
    this.settlementBatcher = options.settlementBatcher ?? settlementBatcher;
    this.stealthScanner = options.stealthScanner ?? require('./stealth-scanner').stealthScanner;
    this.clock = options.clock ?? new (require('./clock').SystemClock)();
  }

  async executeRenewal(request: RenewalRequest): Promise<RenewalResult> {
    const { subscriptionId, userId, approvalId, amount } = request;

    try {
      // Step 1: Check approval
      const approval = await this.checkApproval(subscriptionId, approvalId, amount);
      if (!approval.valid) {
        return await this.logFailure(subscriptionId, userId, 'invalid_approval', approval.reason);
      }

      // Step 2: Validate billing window
      const billingWindow = await this.validateBillingWindow(subscriptionId);
      if (!billingWindow.valid) {
        return await this.logFailure(subscriptionId, userId, 'billing_window_invalid', billingWindow.reason);
      }

      // Step 3: Stealth address — derive ephemeral payment address when enabled
      let stealthAddress: string | undefined;
      let ephemeralPubkey: string | undefined;
      const stealthEnabled = process.env.STEALTH_PAYMENTS_ENABLED === 'true';
      if (stealthEnabled) {
        const meta = await this.resolveStealthMetaAddress(userId);
        if (meta) {
          try {
            const derived = deriveEphemeralStealthAddress(meta, `${subscriptionId}:${approvalId}`);
            stealthAddress = derived.stealthAddress;
            ephemeralPubkey = derived.ephemeralPubkey;
            this.logger.info('Stealth renewal payment address derived', {
              subscriptionId,
              ephemeralPubkey,
              stealthAddress,
            });
          } catch (stealthErr) {
            this.logger.warn('Stealth derivation failed, falling back to standard renewal', {
              subscriptionId,
              error: stealthErr instanceof Error ? stealthErr.message : String(stealthErr),
            });
          }
        }
      }

      // Step 4: Payment channel — off-chain renewal when active channel exists
      const channelRenewal = await this.tryChannelRenewal(userId, subscriptionId, amount);
      if (channelRenewal.used) {
        await this.updateSubscription(
          subscriptionId,
          billingWindow.billingCycle ?? 'monthly',
        );
        await this.logSuccess(subscriptionId, userId, undefined, stealthAddress, ephemeralPubkey);
        return { success: true, subscriptionId };
      }

      // Step 5: Queue settlement for batched on-chain submission
      const settlementId = await this.settlementBatcher.enqueue({
        userId,
        subscriptionId,
        amount,
        settlementType: 'renewal',
        payload: {
          approvalId,
          stealthAddress,
          ephemeralPubkey,
        },
      });

      const contractResult = await this.triggerContractRenewal(
        subscriptionId,
        approvalId,
        amount,
        stealthAddress,
      );

      if (!contractResult.success) {
        return await this.logFailure(subscriptionId, userId, 'contract_failure', contractResult.error);
      }

      // Step 6: Update DB
      await this.updateSubscription(
        subscriptionId,
        billingWindow.billingCycle ?? 'monthly',
        contractResult.transactionHash,
      );

      // Step 7: Log result
      await this.logSuccess(
        subscriptionId,
        userId,
        contractResult.transactionHash,
        stealthAddress,
        ephemeralPubkey,
      );

      this.logger.debug('Settlement queued for batch', { settlementId, subscriptionId });

      return {
        success: true,
        subscriptionId,
        transactionHash: contractResult.transactionHash,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('Renewal execution failed:', { subscriptionId, error: errorMsg });
      return await this.logFailure(subscriptionId, userId, 'execution_error', errorMsg);
    }
  }

  async executeRenewalWithRetry(request: RenewalRequest, maxRetries = 3): Promise<RenewalResult> {
    let lastResult: RenewalResult | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.logger.info(`Renewal attempt ${attempt}/${maxRetries}`, { subscriptionId: request.subscriptionId });

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
    subscriptionId: string,
    approvalId: string,
    amount: number
  ): Promise<{ valid: boolean; reason?: string }> {
    const { data: approval, error } = await this.supabase
      .from('renewal_approvals')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .eq('approval_id', approvalId)
      .eq('used', false)
      .single();

    if (error || !approval) {
      return { valid: false, reason: 'Approval not found' };
    }

    if (approval.expires_at && new Date(approval.expires_at) < this.clock.now()) {
      return { valid: false, reason: 'Approval expired' };
    }

    if (approval.max_spend && amount > approval.max_spend) {
      return { valid: false, reason: 'Amount exceeds max spend' };
    }

    return { valid: true };
  }

  private async validateBillingWindow(
    subscriptionId: string
  ): Promise<{ valid: boolean; reason?: string; billingCycle?: 'monthly' | 'quarterly' | 'yearly' }> {
    const { data: subscription, error } = await this.supabase
      .from('subscriptions')
      .select('next_billing_date, status, billing_cycle')
      .eq('id', subscriptionId)
      .single();

    if (error || !subscription) {
      return { valid: false, reason: 'Subscription not found' };
    }

    if (subscription.status !== 'active') {
      return { valid: false, reason: 'Subscription not active' };
    }

    const nextBilling = new Date(subscription.next_billing_date);
    const now = this.clock.now();
    const daysUntilBilling = Math.ceil((nextBilling.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilBilling > 7) {
      return { valid: false, reason: 'Too early for renewal' };
    }

    return { valid: true, billingCycle: subscription.billing_cycle };
  }

  private async resolveStealthMetaAddress(
    userId: string,
  ): Promise<{ viewPublicKey: string; spendPublicKey: string } | null> {
    const envView = process.env.STEALTH_VIEW_PUBKEY;
    const envSpend = process.env.STEALTH_SPEND_PUBKEY;
    if (envView && envSpend) {
      return { viewPublicKey: envView, spendPublicKey: envSpend };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('stealth_meta_address')
      .eq('id', userId)
      .single();

    const raw = profile?.stealth_meta_address as string | null;
    if (!raw?.startsWith('syncro:stealth:v1:')) return null;

    const [spend, view] = raw.replace('syncro:stealth:v1:', '').split(':');
    if (!spend || !view) return null;
    return { spendPublicKey: spend, viewPublicKey: view };
  }

  private async tryChannelRenewal(
    userId: string,
    subscriptionId: string,
    amount: number,
  ): Promise<{ used: boolean }> {
    if (process.env.PAYMENT_CHANNELS_ENABLED !== 'true') {
      return { used: false };
    }

    try {
      const channel = await this.channelStateService.findPayableChannel(userId, amount);
      if (!channel) return { used: false };

      await this.channelStateService.applyRenewalPayment(
        channel.id,
        userId,
        subscriptionId,
        amount,
      );
      this.logger.info('Off-chain channel renewal applied', {
        channelId: channel.id,
        subscriptionId,
      });
      return { used: true };
    } catch (err) {
      this.logger.warn('Channel renewal failed, falling back to on-chain', {
        subscriptionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { used: false };
    }
  }

  private async triggerContractRenewal(
    subscriptionId: string,
    approvalId: string,
    amount: number,
    stealthAddress?: string,
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      const result = await this.blockchainService.syncSubscription(
        subscriptionId,
        subscriptionId,
        'update',
        {
          status: 'renewed',
          amount,
          ...(stealthAddress ? { paymentAddress: stealthAddress } : {}),
        },
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
    subscriptionId: string,
    billingCycle: 'monthly' | 'quarterly' | 'yearly',
    transactionHash?: string
  ): Promise<void> {
    const now = this.clock.now();
    let nextBilling: Date;

    switch (billingCycle) {
      case 'monthly':
        nextBilling = addMonths(now, 1);
        break;
      case 'quarterly':
        nextBilling = addQuarters(now, 1);
        break;
      case 'yearly':
        nextBilling = addYears(now, 1);
        break;
      default:
        nextBilling = addMonths(now, 1);
    }

    await this.supabase
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
    subscriptionId: string,
    userId: string,
    transactionHash?: string,
    stealthAddress?: string,
    ephemeralPubkey?: string,
  ): Promise<void> {
    const correlationId = getRequestId();
    
    await this.supabase.from('renewal_logs').insert({
      subscription_id: subscriptionId,
      user_id: userId,
      status: 'success',
      transaction_hash: transactionHash,
      stealth_address: stealthAddress ?? null,
      ephemeral_pubkey: ephemeralPubkey ?? null,
      correlation_id: correlationId,
      created_at: this.clock.now().toISOString(),
    });

    this.logger.info('Renewal executed successfully', { 
      subscriptionId, 
      transactionHash,
      correlationId 
    });

    // Telegram payment confirmation (non-blocking)
    try {
      const { telegramNotificationService } = await import('./telegram-notification-service');
      const { data: sub } = await this.supabase
        .from('subscriptions')
        .select('name, price, currency, billing_cycle')
        .eq('id', subscriptionId)
        .single();

      if (sub) {
        telegramNotificationService
          .sendPaymentConfirmation(userId, {
            subscriptionName: sub.name,
            amount: sub.price,
            currency: sub.currency,
            billingCycle: sub.billing_cycle,
            transactionHash,
          })
          .catch((err) => this.logger.warn('Telegram payment confirmation failed', { err }));
      }
    } catch {
      // non-blocking
    }

    // Dispatch webhook event
    try {
      this.webhookService.dispatchEvent(userId, 'subscription.renewed', {
        subscription_id: subscriptionId,
        transaction_hash: transactionHash
      });
    } catch (err) {
      this.logger.error('Failed to dispatch subscription.renewed webhook:', err);
    }
  }

  private async logFailure(
    subscriptionId: string,
    userId: string,
    failureReason: string,
    errorMessage?: string
  ): Promise<RenewalResult> {
    const correlationId = getRequestId();
    
    await this.supabase.from('renewal_logs').insert({
      subscription_id: subscriptionId,
      user_id: userId,
      status: 'failed',
      failure_reason: failureReason,
      error_message: errorMessage,
      correlation_id: correlationId,
      created_at: this.clock.now().toISOString(),
    });

    this.logger.error('Renewal failed', { 
      subscriptionId, 
      failureReason, 
      errorMessage,
      correlationId 
    });

    // Dispatch webhook event
    try {
      this.webhookService.dispatchEvent(userId, 'subscription.renewal_failed', {
        subscription_id: subscriptionId,
        failure_reason: failureReason,
        error_message: errorMessage
      });
    } catch (err) {
      this.logger.error('Failed to dispatch subscription.renewal_failed webhook:', err);
    }

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
