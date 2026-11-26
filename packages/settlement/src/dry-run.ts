/** Inputs needed to estimate one channel settlement without signing or writing. */
export interface SettlementDryRunItem {
  channelId: string;
  amount: bigint;
  nonce: number;
  expectedNonce: number;
  capacity: bigint;
  settled: bigint;
  feeBase: bigint;
  feePerOperation: bigint;
  operationCount: number;
}

export interface SettlementDryRunRow {
  channelId: string;
  amount: string;
  nonce: number;
  estimatedFee: string;
  outcome: 'would_submit' | 'would_fail';
  failures: string[];
}

export interface SettlementDryRunReport {
  items: SettlementDryRunRow[];
  totals: { amount: string; estimatedFee: string; ready: number; failed: number };
}

/**
 * Evaluate a proposed batch using the same state invariants as settlement.
 * This function is pure: it does not sign, persist, or submit anything.
 */
export function simulateSettlementBatch(items: SettlementDryRunItem[]): SettlementDryRunReport {
  let totalAmount = 0n;
  let totalFee = 0n;
  let ready = 0;
  let failed = 0;

  const rows = items.map((item): SettlementDryRunRow => {
    if (!Number.isSafeInteger(item.operationCount) || item.operationCount < 0) {
      throw new RangeError('operationCount must be a non-negative integer');
    }
    if (item.amount < 0n || item.capacity < 0n || item.settled < 0n || item.feeBase < 0n || item.feePerOperation < 0n) {
      throw new RangeError('amount, capacity, settled value, and fee inputs must be non-negative');
    }
    const estimatedFee = item.feeBase + item.feePerOperation * BigInt(item.operationCount);
    const failures: string[] = [];
    if (!item.channelId.trim()) failures.push('missing_channel');
    if (!Number.isSafeInteger(item.nonce) || item.nonce < 0) failures.push('invalid_nonce');
    if (item.nonce !== item.expectedNonce) failures.push('nonce_mismatch');
    if (item.settled + item.amount > item.capacity) failures.push('capacity_exceeded');
    if (item.amount === 0n) failures.push('zero_amount');

    totalAmount += item.amount;
    totalFee += estimatedFee;
    const outcome = failures.length === 0 ? 'would_submit' : 'would_fail';
    if (outcome === 'would_submit') ready += 1;
    else failed += 1;
    return {
      channelId: item.channelId,
      amount: item.amount.toString(),
      nonce: item.nonce,
      estimatedFee: estimatedFee.toString(),
      outcome,
      failures,
    };
  });

  return {
    items: rows,
    totals: { amount: totalAmount.toString(), estimatedFee: totalFee.toString(), ready, failed },
  };
}
