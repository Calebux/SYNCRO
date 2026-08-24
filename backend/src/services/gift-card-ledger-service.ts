import { supabase, databaseRepository } from '../config/database';
import logger from '../config/logger';

export interface LedgerEntry {
  id: string;
  user_id: string;
  subscription_id: string | null;
  amount: number;
  type: 'top_up' | 'deduction';
  description: string | null;
  balance_after: number;
  created_at: string;
}

export class GiftCardLedgerService {
  async getBalance(userId: string): Promise<number> {
    const { data, error } = await databaseRepository
      .from('gift_card_balance')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to fetch gift card balance:', error);
      throw error;
    }
    return Number(data?.balance ?? 0);
  }

  async topUp(userId: string, amount: number, description?: string): Promise<LedgerEntry> {
    if (amount <= 0) throw new Error('Top-up amount must be positive');

    const currentBalance = await this.getBalance(userId);
    const balanceAfter = currentBalance + amount;

    const { data, error } = await databaseRepository
      .from('gift_card_ledger')
      .insert({
        user_id: userId,
        amount,
        type: 'top_up',
        description: description ?? 'Gift card top-up',
        balance_after: balanceAfter,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to record top-up:', error);
      throw error;
    }

    logger.info('Gift card top-up recorded', { userId, amount, balanceAfter });
    return data as LedgerEntry;
  }

  /**
   * Deduct subscription cost from the user's gift card balance.
   * Called autonomously each billing cycle.
   */
  async deduct(
    userId: string,
    subscriptionId: string,
    amount: number,
    description?: string,
  ): Promise<LedgerEntry> {
    if (amount <= 0) throw new Error('Deduction amount must be positive');

    const currentBalance = await this.getBalance(userId);
    if (currentBalance < amount) {
      throw new Error(
        `Insufficient balance: $${currentBalance.toFixed(2)} available, $${amount.toFixed(2)} required`,
      );
    }

    const balanceAfter = currentBalance - amount;

    const { data, error } = await databaseRepository
      .from('gift_card_ledger')
      .insert({
        user_id: userId,
        subscription_id: subscriptionId,
        amount: -amount,
        type: 'deduction',
        description: description ?? 'Subscription deduction',
        balance_after: balanceAfter,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to record deduction:', error);
      throw error;
    }

    logger.info('Gift card deduction recorded', { userId, subscriptionId, amount, balanceAfter });
    return data as LedgerEntry;
  }

  async getHistory(userId: string, limit = 50): Promise<LedgerEntry[]> {
    const { data, error } = await databaseRepository
      .from('gift_card_ledger')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch ledger history:', error);
      throw error;
    }
    return (data ?? []) as LedgerEntry[];
  }
}

export const giftCardLedgerService = new GiftCardLedgerService();
