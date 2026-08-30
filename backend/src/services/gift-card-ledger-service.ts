import { supabase } from '../config/database';
import logger from '../config/logger';

export type ReasonCode =
  | 'PURCHASE'
  | 'REDEMPTION'
  | 'EXPIRY'
  | 'ADJUSTMENT'
  | 'REVERSAL'
  | 'TOP_UP'
  | 'DEDUCTION';

export interface PostingEntry {
  id: string;
  transaction_id: string;
  account_id: string;
  user_id: string | null;
  subscription_id: string | null;
  gift_card_id: string | null;
  amount: number;
  reason_code: ReasonCode;
  created_at: string;
}

export interface TransactionEntry {
  id: string;
  user_id: string;
  reason_code: ReasonCode;
  description: string | null;
  reference_id: string | null;
  reversal_of_transaction_id: string | null;
  created_at: string;
  postings?: PostingEntry[];
}

// In-memory mutex map per account to guarantee atomicity during concurrent requests in single process
const accountLocks = new Map<string, Promise<void>>();

async function acquireLock<T>(accountId: string, action: () => Promise<T>): Promise<T> {
  while (accountLocks.has(accountId)) {
    await accountLocks.get(accountId);
  }
  let unlock: () => void = () => {};
  const lockPromise = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  accountLocks.set(accountId, lockPromise);

  try {
    return await action();
  } finally {
    accountLocks.delete(accountId);
    unlock();
  }
}

export class GiftCardLedgerService {
  /**
   * Derive account balance on-the-fly by summing all postings.
   * No stored mutable balance field is written or read.
   */
  async getBalance(userId: string): Promise<number> {
    const userAccountId = `user:gift_card:${userId}`;
    const { data, error } = await supabase
      .from('gift_card_ledger_postings')
      .select('amount')
      .or(`account_id.eq.${userAccountId},account_id.eq.user:${userId}`);

    if (error) {
      logger.error('Failed to fetch gift card balance postings:', error);
      throw error;
    }

    const total = (data || []).reduce((acc, row) => acc + Number(row.amount), 0);
    return Math.round(total * 100) / 100;
  }

  /**
   * Execute a double-entry transaction.
   * Validates:
   * 1. Transaction postings sum strictly to 0.
   * 2. Non-overdraft accounts (e.g. user:gift_card:*) do not go below zero.
   */
  private async executeTransaction(params: {
    userId: string;
    reasonCode: ReasonCode;
    description?: string;
    referenceId?: string;
    reversalOfTransactionId?: string;
    postings: {
      account_id: string;
      user_id?: string | null;
      subscription_id?: string | null;
      gift_card_id?: string | null;
      amount: number;
    }[];
  }): Promise<TransactionEntry> {
    const userAccountId = `user:gift_card:${params.userId}`;

    return acquireLock(userAccountId, async () => {
      // Rule 1: Zero-Sum Invariant
      const postingsSum = params.postings.reduce((sum, p) => sum + p.amount, 0);
      const roundedSum = Math.round(postingsSum * 100) / 100;
      if (Math.abs(roundedSum) > 0.0001) {
        throw new Error(`Transaction postings must sum to zero. Current sum: ${roundedSum}`);
      }

      // Rule 2: Overdraft check for user gift card accounts
      const userNetChanges = new Map<string, number>();
      for (const p of params.postings) {
        if (p.account_id.startsWith('user:gift_card:') || p.account_id.startsWith('user:')) {
          const uId = p.user_id || params.userId;
          userNetChanges.set(uId, (userNetChanges.get(uId) || 0) + p.amount);
        }
      }

      for (const [uId, netChange] of userNetChanges.entries()) {
        const currentBalance = await this.getBalance(uId);
        const balanceAfter = Math.round((currentBalance + netChange) * 100) / 100;
        if (balanceAfter < 0) {
          throw new Error(
            `Insufficient balance: $${currentBalance.toFixed(2)} available, $${Math.abs(netChange).toFixed(2)} required`
          );
        }
      }

      // Create transaction header
      const { data: txData, error: txError } = await supabase
        .from('gift_card_ledger_transactions')
        .insert({
          user_id: params.userId,
          reason_code: params.reasonCode,
          description: params.description ?? null,
          reference_id: params.referenceId ?? null,
          reversal_of_transaction_id: params.reversalOfTransactionId ?? null,
        })
        .select()
        .single();

      if (txError) {
        logger.error('Failed to create ledger transaction:', txError);
        throw txError;
      }

      // Create postings
      const postingInserts = params.postings.map((p) => ({
        transaction_id: txData.id,
        account_id: p.account_id,
        user_id: p.user_id !== undefined ? p.user_id : params.userId,
        subscription_id: p.subscription_id ?? null,
        gift_card_id: p.gift_card_id ?? null,
        amount: Math.round(p.amount * 100) / 100,
        reason_code: params.reasonCode,
      }));

      const { data: postingsData, error: postingsError } = await supabase
        .from('gift_card_ledger_postings')
        .insert(postingInserts)
        .select();

      if (postingsError) {
        logger.error('Failed to insert ledger postings:', postingsError);
        throw postingsError;
      }

      logger.info('Ledger double-entry transaction recorded', {
        txId: txData.id,
        userId: params.userId,
        reasonCode: params.reasonCode,
        postingsCount: postingInserts.length,
      });

      return {
        ...txData,
        postings: postingsData as PostingEntry[],
      } as TransactionEntry;
    });
  }

  /**
   * Top up user gift card balance.
   * Balanced postings:
   * Debit: user:gift_card:<userId> (+amount)
   * Credit: system:liability:gift_card (-amount)
   */
  async topUp(
    userId: string,
    amount: number,
    description?: string,
    referenceId?: string
  ): Promise<TransactionEntry> {
    if (amount <= 0) throw new Error('Top-up amount must be positive');

    const userAccountId = `user:gift_card:${userId}`;
    const systemLiabilityAccountId = 'system:liability:gift_card';

    return this.executeTransaction({
      userId,
      reasonCode: 'TOP_UP',
      description: description ?? 'Gift card top-up',
      referenceId,
      postings: [
        {
          account_id: userAccountId,
          user_id: userId,
          amount: amount,
        },
        {
          account_id: systemLiabilityAccountId,
          user_id: null,
          amount: -amount,
        },
      ],
    });
  }

  /**
   * Deduct subscription payment from user gift card balance.
   * Balanced postings:
   * Credit: user:gift_card:<userId> (-amount)
   * Debit: system:revenue:subscription (+amount)
   */
  async deduct(
    userId: string,
    subscriptionId: string,
    amount: number,
    description?: string,
    referenceId?: string
  ): Promise<TransactionEntry> {
    if (amount <= 0) throw new Error('Deduction amount must be positive');

    const userAccountId = `user:gift_card:${userId}`;
    const systemRevenueAccountId = 'system:revenue:subscription';

    return this.executeTransaction({
      userId,
      reasonCode: 'DEDUCTION',
      description: description ?? 'Subscription deduction',
      referenceId,
      postings: [
        {
          account_id: userAccountId,
          user_id: userId,
          subscription_id: subscriptionId,
          amount: -amount,
        },
        {
          account_id: systemRevenueAccountId,
          user_id: null,
          subscription_id: subscriptionId,
          amount: amount,
        },
      ],
    });
  }

  /**
   * Reverse an existing transaction by creating compensating postings.
   * Prior rows are NEVER modified or deleted.
   */
  async reverseTransaction(
    userId: string,
    originalTransactionId: string,
    description?: string
  ): Promise<TransactionEntry> {
    // Check if transaction has already been reversed
    const { data: existingReversal } = await supabase
      .from('gift_card_ledger_transactions')
      .select('id')
      .eq('reversal_of_transaction_id', originalTransactionId)
      .maybeSingle();

    if (existingReversal) {
      throw new Error(`Transaction ${originalTransactionId} has already been reversed`);
    }

    // Fetch original transaction
    const { data: origTx, error: origTxError } = await supabase
      .from('gift_card_ledger_transactions')
      .select('*')
      .eq('id', originalTransactionId)
      .single();

    if (origTxError || !origTx) {
      throw new Error(`Original transaction ${originalTransactionId} not found`);
    }

    // Fetch original postings
    const { data: origPostings, error: origPostingsError } = await supabase
      .from('gift_card_ledger_postings')
      .select('*')
      .eq('transaction_id', originalTransactionId);

    if (origPostingsError || !origPostings || origPostings.length === 0) {
      throw new Error(`No postings found for transaction ${originalTransactionId}`);
    }

    // Invert posting amounts for compensating entry
    const compensatingPostings = origPostings.map((p) => ({
      account_id: p.account_id,
      user_id: p.user_id,
      subscription_id: p.subscription_id,
      gift_card_id: p.gift_card_id,
      amount: -Number(p.amount),
    }));

    return this.executeTransaction({
      userId,
      reasonCode: 'REVERSAL',
      description: description ?? `Reversal of transaction ${originalTransactionId}`,
      reversalOfTransactionId: originalTransactionId,
      postings: compensatingPostings,
    });
  }

  /**
   * Expire unused gift card balance.
   * Balanced postings:
   * Credit: user:gift_card:<userId> (-amount)
   * Debit: system:expense:expiry (+amount)
   */
  async expireBalance(
    userId: string,
    amount: number,
    description?: string
  ): Promise<TransactionEntry> {
    if (amount <= 0) throw new Error('Expiry amount must be positive');

    const userAccountId = `user:gift_card:${userId}`;
    const systemExpenseAccountId = 'system:expense:expiry';

    return this.executeTransaction({
      userId,
      reasonCode: 'EXPIRY',
      description: description ?? 'Gift card balance expiry',
      postings: [
        {
          account_id: userAccountId,
          user_id: userId,
          amount: -amount,
        },
        {
          account_id: systemExpenseAccountId,
          user_id: null,
          amount: amount,
        },
      ],
    });
  }

  /**
   * Manual ledger adjustment.
   * Balanced postings:
   * User account: +amount (if adding) or -amount (if reducing)
   * System adjustment equity: -amount or +amount
   */
  async adjustBalance(
    userId: string,
    amount: number,
    description?: string
  ): Promise<TransactionEntry> {
    if (amount === 0) throw new Error('Adjustment amount must be non-zero');

    const userAccountId = `user:gift_card:${userId}`;
    const systemEquityAccountId = 'system:equity:adjustment';

    return this.executeTransaction({
      userId,
      reasonCode: 'ADJUSTMENT',
      description: description ?? 'Manual balance adjustment',
      postings: [
        {
          account_id: userAccountId,
          user_id: userId,
          amount: amount,
        },
        {
          account_id: systemEquityAccountId,
          user_id: null,
          amount: -amount,
        },
      ],
    });
  }

  /**
   * Fetch transaction/postings history for user.
   */
  async getHistory(userId: string, limit = 50): Promise<PostingEntry[]> {
    const userAccountId = `user:gift_card:${userId}`;
    const { data, error } = await supabase
      .from('gift_card_ledger_postings')
      .select('*')
      .or(`account_id.eq.${userAccountId},user_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch ledger history:', error);
      throw error;
    }

    return (data || []) as PostingEntry[];
  }
}

export const giftCardLedgerService = new GiftCardLedgerService();
