import { GiftCardLedgerService } from '../src/services/gift-card-ledger-service';
import { GiftCardLedgerVerifier } from '../src/services/gift-card-ledger-verifier';
import { supabase } from '../src/config/database';

jest.mock('../src/config/logger');

// Mock Supabase
jest.mock('../src/config/database', () => {
  return {
    supabase: {
      from: jest.fn(),
    },
  };
});

describe('GiftCardLedgerService (Immutable Double-Entry Ledger)', () => {
  let ledgerService: GiftCardLedgerService;
  let verifier: GiftCardLedgerVerifier;
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testSubscriptionId = '00000000-0000-0000-0000-000000000002';
  const userAccountId = `user:gift_card:${testUserId}`;

  beforeEach(() => {
    jest.clearAllMocks();
    ledgerService = new GiftCardLedgerService();
    verifier = new GiftCardLedgerVerifier();
  });

  describe('getBalance', () => {
    it('derives balance from postings sum without any stored balance field', async () => {
      const mockPostings = [
        { amount: 100 },
        { amount: -30 },
        { amount: -20 },
      ];

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        or: jest.fn().mockResolvedValue({ data: mockPostings, error: null }),
      });

      const balance = await ledgerService.getBalance(testUserId);
      expect(balance).toBe(50.0);
    });

    it('returns 0 when no postings exist', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        or: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const balance = await ledgerService.getBalance(testUserId);
      expect(balance).toBe(0);
    });
  });

  describe('topUp', () => {
    it('creates a zero-sum double-entry transaction pair with reason code TOP_UP', async () => {
      // Mock getBalance = 0
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'gift_card_ledger_postings') {
          return {
            select: jest.fn().mockReturnThis(),
            or: jest.fn().mockResolvedValue({ data: [], error: null }),
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'p-1',
                    transaction_id: 'tx-1',
                    account_id: userAccountId,
                    user_id: testUserId,
                    amount: 50,
                    reason_code: 'TOP_UP',
                  },
                  {
                    id: 'p-2',
                    transaction_id: 'tx-1',
                    account_id: 'system:liability:gift_card',
                    user_id: null,
                    amount: -50,
                    reason_code: 'TOP_UP',
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'gift_card_ledger_transactions') {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'tx-1',
                    user_id: testUserId,
                    reason_code: 'TOP_UP',
                    description: 'Gift card top-up',
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const tx = await ledgerService.topUp(testUserId, 50, 'Gift card top-up');
      expect(tx.reason_code).toBe('TOP_UP');
      expect(tx.postings).toHaveLength(2);

      const userPosting = tx.postings?.find((p) => p.account_id === userAccountId);
      const systemPosting = tx.postings?.find((p) => p.account_id === 'system:liability:gift_card');

      expect(userPosting?.amount).toBe(50);
      expect(systemPosting?.amount).toBe(-50);

      // Verify Zero-Sum invariant
      const sum = (tx.postings || []).reduce((acc, p) => acc + p.amount, 0);
      expect(sum).toBe(0);
    });

    it('rejects non-positive top-up amounts', async () => {
      await expect(ledgerService.topUp(testUserId, 0)).rejects.toThrow('Top-up amount must be positive');
      await expect(ledgerService.topUp(testUserId, -10)).rejects.toThrow('Top-up amount must be positive');
    });
  });

  describe('deduct', () => {
    it('creates a zero-sum double-entry transaction pair for subscription deduction', async () => {
      // Mock getBalance = 100
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'gift_card_ledger_postings') {
          return {
            select: jest.fn().mockReturnThis(),
            or: jest.fn().mockResolvedValue({ data: [{ amount: 100 }], error: null }),
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'p-1',
                    transaction_id: 'tx-2',
                    account_id: userAccountId,
                    user_id: testUserId,
                    subscription_id: testSubscriptionId,
                    amount: -40,
                    reason_code: 'DEDUCTION',
                  },
                  {
                    id: 'p-2',
                    transaction_id: 'tx-2',
                    account_id: 'system:revenue:subscription',
                    user_id: null,
                    subscription_id: testSubscriptionId,
                    amount: 40,
                    reason_code: 'DEDUCTION',
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'gift_card_ledger_transactions') {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'tx-2',
                    user_id: testUserId,
                    reason_code: 'DEDUCTION',
                    description: 'Subscription deduction',
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const tx = await ledgerService.deduct(testUserId, testSubscriptionId, 40);
      expect(tx.reason_code).toBe('DEDUCTION');
      expect(tx.postings).toHaveLength(2);

      const userPosting = tx.postings?.find((p) => p.account_id === userAccountId);
      const revenuePosting = tx.postings?.find((p) => p.account_id === 'system:revenue:subscription');

      expect(userPosting?.amount).toBe(-40);
      expect(revenuePosting?.amount).toBe(40);

      // Verify Zero-Sum invariant
      const sum = (tx.postings || []).reduce((acc, p) => acc + p.amount, 0);
      expect(sum).toBe(0);
    });

    it('enforces non-negative balance invariant and throws Insufficient balance', async () => {
      // Mock getBalance = 20
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'gift_card_ledger_postings') {
          return {
            select: jest.fn().mockReturnThis(),
            or: jest.fn().mockResolvedValue({ data: [{ amount: 20 }], error: null }),
          };
        }
        return {};
      });

      await expect(
        ledgerService.deduct(testUserId, testSubscriptionId, 50)
      ).rejects.toThrow(/Insufficient balance/i);
    });
  });

  describe('reverseTransaction', () => {
    it('creates compensating postings with REVERSAL reason code leaving prior entries untouched', async () => {
      const originalTxId = '00000000-0000-0000-0000-000000000099';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'gift_card_ledger_transactions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            single: jest.fn().mockResolvedValue({
              data: {
                id: originalTxId,
                user_id: testUserId,
                reason_code: 'DEDUCTION',
              },
              error: null,
            }),
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 'tx-reversal-1',
                    user_id: testUserId,
                    reason_code: 'REVERSAL',
                    reversal_of_transaction_id: originalTxId,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'gift_card_ledger_postings') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockResolvedValue({ data: [{ amount: 0 }], error: null }),
              eq: jest.fn().mockResolvedValue({
                data: [
                  { account_id: userAccountId, user_id: testUserId, amount: -30 },
                  { account_id: 'system:revenue:subscription', user_id: null, amount: 30 },
                ],
                error: null,
              }),
            }),
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockResolvedValue({
                data: [
                  { account_id: userAccountId, user_id: testUserId, amount: 30, reason_code: 'REVERSAL' },
                  { account_id: 'system:revenue:subscription', user_id: null, amount: -30, reason_code: 'REVERSAL' },
                ],
                error: null,
              }),
            }),
          };
        }
        return {};
      });

      const reversalTx = await ledgerService.reverseTransaction(testUserId, originalTxId);
      expect(reversalTx.reason_code).toBe('REVERSAL');
      expect(reversalTx.reversal_of_transaction_id).toBe(originalTxId);

      const sum = (reversalTx.postings || []).reduce((acc, p) => acc + p.amount, 0);
      expect(sum).toBe(0);
    });

    it('prevents double-reversals of the same original transaction', async () => {
      const originalTxId = '00000000-0000-0000-0000-000000000099';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'gift_card_ledger_transactions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'existing-reversal-id' },
            }),
          };
        }
        return {};
      });

      await expect(
        ledgerService.reverseTransaction(testUserId, originalTxId)
      ).rejects.toThrow(/already been reversed/i);
    });
  });

  describe('GiftCardLedgerVerifier', () => {
    it('asserts transaction zero-sum invariant and logs no alert when valid', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'gift_card_ledger_postings') {
          return {
            select: jest.fn().mockResolvedValue({
              data: [
                { transaction_id: 'tx-1', account_id: userAccountId, amount: 50 },
                { transaction_id: 'tx-1', account_id: 'system:liability:gift_card', amount: -50 },
              ],
              error: null,
            }),
          };
        }
        if (table === 'gift_card_ledger_checkpoints') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      const summary = await verifier.verifyLedger();
      expect(summary.success).toBe(true);
      expect(summary.mismatches).toHaveLength(0);
    });

    it('detects and alerts when transaction postings do not sum to zero', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'gift_card_ledger_postings') {
          return {
            select: jest.fn().mockResolvedValue({
              data: [
                { transaction_id: 'bad-tx-1', account_id: userAccountId, amount: 50 },
                { transaction_id: 'bad-tx-1', account_id: 'system:liability:gift_card', amount: -40 }, // unbalanced!
              ],
              error: null,
            }),
          };
        }
        if (table === 'gift_card_ledger_checkpoints') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      });

      const summary = await verifier.verifyLedger();
      expect(summary.success).toBe(false);
      expect(summary.mismatches.some((m) => m.account_id === 'tx:bad-tx-1')).toBe(true);
    });
  });
});
