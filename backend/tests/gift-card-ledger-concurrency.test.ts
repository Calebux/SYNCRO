import { GiftCardLedgerService } from '../src/services/gift-card-ledger-service';
import { supabase } from '../src/config/database';

jest.mock('../src/config/logger');

jest.mock('../src/config/database', () => {
  return {
    supabase: {
      from: jest.fn(),
    },
  };
});

describe('GiftCardLedgerService Concurrency & Overdraft Safety', () => {
  let ledgerService: GiftCardLedgerService;
  const testUserId = '00000000-0000-0000-0000-000000000099';
  const testSubscriptionId = '00000000-0000-0000-0000-000000000088';
  const userAccountId = `user:gift_card:${testUserId}`;

  beforeEach(() => {
    jest.clearAllMocks();
    ledgerService = new GiftCardLedgerService();
  });

  it('prevents overdrawing under concurrent redemption requests against the same card/balance', async () => {
    // Initial balance = $50
    const postingLedger: { account_id: string; amount: number; transaction_id: string }[] = [
      { account_id: userAccountId, amount: 50, transaction_id: 'init-tx' },
      { account_id: 'system:liability:gift_card', amount: -50, transaction_id: 'init-tx' },
    ];

    let txCounter = 0;

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'gift_card_ledger_postings') {
        return {
          select: jest.fn().mockReturnValue({
            or: jest.fn().mockImplementation(async () => {
              const userPostings = postingLedger.filter(
                (p) => p.account_id === userAccountId || p.account_id === `user:${testUserId}`
              );
              return { data: userPostings, error: null };
            }),
          }),
          insert: jest.fn().mockImplementation((newPostings: any[]) => {
            for (const p of newPostings) {
              postingLedger.push(p);
            }
            return {
              select: jest.fn().mockResolvedValue({
                data: newPostings.map((p, idx) => ({ ...p, id: `p-${idx}` })),
                error: null,
              }),
            };
          }),
        };
      }
      if (table === 'gift_card_ledger_transactions') {
        return {
          insert: jest.fn().mockImplementation(() => {
            txCounter++;
            return {
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: `tx-concurrent-${txCounter}`,
                    user_id: testUserId,
                    reason_code: 'DEDUCTION',
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            };
          }),
        };
      }
      return {};
    });

    // 5 concurrent attempts to redeem $30 from a $50 balance
    // Exactly 1 attempt ($30) should succeed; the 4 subsequent attempts should be rejected due to insufficient balance ($20 remaining < $30)
    const redemptionAttempts = Array.from({ length: 5 }).map(() =>
      ledgerService.deduct(testUserId, testSubscriptionId, 30, 'Concurrent redemption test')
    );

    const results = await Promise.allSettled(redemptionAttempts);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Assert exactly 1 redemption succeeded and 4 failed
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);

    // Verify error message on rejected attempts
    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason.message).toMatch(/Insufficient balance/i);
      }
    }

    // Verify derived final balance is $20 (never negative)
    const finalBalance = await ledgerService.getBalance(testUserId);
    expect(finalBalance).toBe(20.0);
    expect(finalBalance).toBeGreaterThanOrEqual(0);
  });
});
