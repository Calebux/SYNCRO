import { supabase } from '../config/database';
import logger from '../config/logger';

export interface VerificationResult {
  account_id: string;
  derived_balance: number;
  expected_balance?: number;
  is_valid: boolean;
  notes: string;
}

export interface VerificationSummary {
  success: boolean;
  total_accounts_checked: number;
  total_transactions_checked: number;
  mismatches: VerificationResult[];
}

export class GiftCardLedgerVerifier {
  /**
   * Run full periodic verification across all ledger accounts and transactions.
   * Asserts:
   * 1. Transaction zero-sum invariant: SUM(amount) == 0 for all postings in every transaction.
   * 2. Account balance derivation matches stored checkpoints (or historical posting sum).
   * 3. Non-overdraft accounts (e.g. user:gift_card:*) have balance >= 0.
   */
  async verifyLedger(): Promise<VerificationSummary> {
    logger.info('Starting periodic gift card ledger verification job...');
    const mismatches: VerificationResult[] = [];
    let totalAccountsChecked = 0;
    let totalTransactionsChecked = 0;

    try {
      // 1. Verify Transaction Zero-Sum Invariant
      const { data: txPostings, error: txError } = await supabase
        .from('gift_card_ledger_postings')
        .select('transaction_id, amount');

      if (txError) {
        logger.error('Failed to fetch postings for zero-sum verification:', txError);
        throw txError;
      }

      const txSumMap = new Map<string, number>();
      for (const posting of txPostings || []) {
        const currentSum = txSumMap.get(posting.transaction_id) || 0;
        // Keep rounding precision to 2 decimals for monetary calculations
        txSumMap.set(posting.transaction_id, Math.round((currentSum + Number(posting.amount)) * 100) / 100);
      }

      totalTransactionsChecked = txSumMap.size;
      for (const [txId, sum] of txSumMap.entries()) {
        if (Math.abs(sum) > 0.001) {
          const notes = `Transaction ${txId} postings do not sum to zero: sum=${sum}`;
          logger.error(`[LEDGER_MISMATCH_ALERT] ${notes}`);
          mismatches.push({
            account_id: `tx:${txId}`,
            derived_balance: sum,
            expected_balance: 0,
            is_valid: false,
            notes,
          });
        }
      }

      // 2. Fetch all postings grouped by account_id
      const { data: postings, error: postingsError } = await supabase
        .from('gift_card_ledger_postings')
        .select('account_id, amount');

      if (postingsError) {
        logger.error('Failed to fetch postings for account balance verification:', postingsError);
        throw postingsError;
      }

      const accountBalances = new Map<string, number>();
      for (const posting of postings || []) {
        const current = accountBalances.get(posting.account_id) || 0;
        accountBalances.set(
          posting.account_id,
          Math.round((current + Number(posting.amount)) * 100) / 100
        );
      }

      totalAccountsChecked = accountBalances.size;

      // 3. Compare with latest stored checkpoints and verify non-negative invariant
      for (const [accountId, derivedBalance] of accountBalances.entries()) {
        // Non-overdraft invariant check for user gift card accounts
        if (accountId.startsWith('user:gift_card:') && derivedBalance < 0) {
          const notes = `Account ${accountId} is negative without overdraft authorization: balance=${derivedBalance}`;
          logger.error(`[LEDGER_MISMATCH_ALERT] ${notes}`);
          mismatches.push({
            account_id: accountId,
            derived_balance: derivedBalance,
            is_valid: false,
            notes,
          });
        }

        // Fetch latest stored checkpoint for this account
        const { data: checkpointData } = await supabase
          .from('gift_card_ledger_checkpoints')
          .select('checkpoint_balance')
          .eq('account_id', accountId)
          .order('verified_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        let isValid = mismatches.every((m) => m.account_id !== accountId);

        if (checkpointData) {
          const expectedBalance = Number(checkpointData.checkpoint_balance);
          if (Math.abs(derivedBalance - expectedBalance) > 0.001) {
            const notes = `Account ${accountId} derived balance (${derivedBalance}) mismatches checkpoint (${expectedBalance})`;
            logger.error(`[LEDGER_MISMATCH_ALERT] ${notes}`);
            mismatches.push({
              account_id: accountId,
              derived_balance: derivedBalance,
              expected_balance: expectedBalance,
              is_valid: false,
              notes,
            });
            isValid = false;
          }
        }

        // Record checkpoint snapshot
        await supabase.from('gift_card_ledger_checkpoints').insert({
          account_id: accountId,
          checkpoint_balance: derivedBalance,
          is_valid: isValid,
          notes: isValid ? 'Derived balance verified successfully' : 'Mismatch detected',
        });
      }

      const success = mismatches.length === 0;
      logger.info('Gift card ledger verification completed.', {
        totalAccountsChecked,
        totalTransactionsChecked,
        mismatchCount: mismatches.length,
        success,
      });

      return {
        success,
        total_accounts_checked: totalAccountsChecked,
        total_transactions_checked: totalTransactionsChecked,
        mismatches,
      };
    } catch (error) {
      logger.error('Error during gift card ledger verification:', error);
      throw error;
    }
  }
}

export const giftCardLedgerVerifier = new GiftCardLedgerVerifier();
