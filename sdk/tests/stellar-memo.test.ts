import {
  buildSyncroMemo,
  parseSyncroMemo,
  validateSyncroMemo,
  verifyTransactionMemo,
  hashSubscriptionId,
} from '../src/stellar/memo.js';

describe('stellar memo', () => {
  const subscriptionId = '550e8400-e29b-41d4-a716-446655440000';

  it('builds standardized memos', () => {
    const memo = buildSyncroMemo('create', subscriptionId);
    expect(memo).toMatch(/^S1:c:[a-f0-9]{12}$/);
    expect(memo).toBe(`S1:c:${hashSubscriptionId(subscriptionId)}`);
  });

  it('parses standardized memos', () => {
    const memo = buildSyncroMemo('update', subscriptionId);
    const parsed = parseSyncroMemo(memo);
    expect(parsed?.legacy).toBe(false);
    expect(parsed?.type).toBe('u');
    expect(parsed?.subscriptionIdHash).toBe(hashSubscriptionId(subscriptionId));
  });

  it('treats unknown memos as legacy for backward compatibility', () => {
    const parsed = parseSyncroMemo('legacy-memo');
    expect(parsed?.legacy).toBe(true);
  });

  it('validates memo against operation and subscription ID', () => {
    const memo = buildSyncroMemo('cancel', subscriptionId);
    expect(validateSyncroMemo(memo, 'cancel', subscriptionId)).toBe(true);
    expect(validateSyncroMemo(memo, 'create', subscriptionId)).toBe(false);
  });

  it('verifies transaction receipts using memo rules', () => {
    const memo = buildSyncroMemo('reminder', subscriptionId);
    expect(
      verifyTransactionMemo({ memo, successful: true, hash: 'abc' }, 'reminder', subscriptionId),
    ).toBe(true);
    expect(
      verifyTransactionMemo({ memo, successful: false, hash: 'abc' }, 'reminder', subscriptionId),
    ).toBe(false);
  });
});
