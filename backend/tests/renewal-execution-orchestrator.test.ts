jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

jest.mock('../src/lib/redis-lock', () => ({
  redisDistributedLock: {
    acquire: jest.fn(),
    release: jest.fn(),
    getMetrics: jest.fn(),
  },
}));

jest.mock('../src/services/renewal-executor', () => ({
  renewalExecutor: { executeRenewal: jest.fn() },
}));

jest.mock('../src/services/renewal-dead-letter-service', () => ({
  renewalDeadLetterService: {
    getAttemptByKey: jest.fn(),
    recordAttempt: jest.fn(),
    updateAttemptStatus: jest.fn(),
    moveToDeadLetter: jest.fn(),
  },
}));

jest.mock('../src/services/idempotency', () => ({
  idempotencyService: {
    generateKey: jest.fn(),
    hashRequest: jest.fn(),
    storeResponse: jest.fn(),
  },
}));

import { RenewalExecutionOrchestrator } from '../src/services/renewal-execution-orchestrator';
import { redisDistributedLock } from '../src/lib/redis-lock';
import { renewalExecutor } from '../src/services/renewal-executor';
import { renewalDeadLetterService } from '../src/services/renewal-dead-letter-service';
import { idempotencyService } from '../src/services/idempotency';
import { supabase } from '../src/config/database';

describe('RenewalExecutionOrchestrator', () => {
  let orchestrator: RenewalExecutionOrchestrator;

  const request = {
    subscriptionId: 'sub-1',
    userId: 'user-1',
    approvalId: 'approval-1',
    amount: 9.99,
    billingDate: '2026-06-27',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new RenewalExecutionOrchestrator();

    (idempotencyService.generateKey as jest.Mock).mockReturnValue('idem-key-1');
    (idempotencyService.hashRequest as jest.Mock).mockReturnValue('hash-1');
    (renewalDeadLetterService.getAttemptByKey as jest.Mock).mockResolvedValue(null);
    (renewalDeadLetterService.recordAttempt as jest.Mock).mockResolvedValue({ id: 'attempt-1' });
    (renewalDeadLetterService.updateAttemptStatus as jest.Mock).mockResolvedValue(undefined);
    (renewalDeadLetterService.moveToDeadLetter as jest.Mock).mockResolvedValue({ id: 'dlq-1' });
    (redisDistributedLock.acquire as jest.Mock).mockResolvedValue({ acquired: true, lockToken: 'token-1' });
    (redisDistributedLock.release as jest.Mock).mockResolvedValue(true);
  });

  it('executes renewal when lock is acquired', async () => {
    (renewalExecutor.executeRenewal as jest.Mock).mockResolvedValue({
      success: true,
      subscriptionId: 'sub-1',
      transactionHash: 'tx-abc',
    });

    const result = await orchestrator.executeIdempotentRenewal(request);

    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe('tx-abc');
    expect(result.idempotencyKey).toBe('idem-key-1');
    expect(redisDistributedLock.acquire).toHaveBeenCalled();
    expect(redisDistributedLock.release).toHaveBeenCalledWith('sub-1', 20260627, 'token-1');
    expect(renewalDeadLetterService.updateAttemptStatus).toHaveBeenCalledWith('idem-key-1', 'success', expect.any(Object));
  });

  it('returns cached result for already successful attempt', async () => {
    (renewalDeadLetterService.getAttemptByKey as jest.Mock).mockResolvedValue({
      status: 'success',
      result: { success: true, subscriptionId: 'sub-1', transactionHash: 'tx-cached' },
    });

    const result = await orchestrator.executeIdempotentRenewal(request);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_processed');
    expect(renewalExecutor.executeRenewal).not.toHaveBeenCalled();
  });

  it('handles lock contention gracefully', async () => {
    (redisDistributedLock.acquire as jest.Mock).mockResolvedValue({ acquired: false, reason: 'contention' });

    const result = await orchestrator.executeIdempotentRenewal(request);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('lock_contention');
    expect(renewalExecutor.executeRenewal).not.toHaveBeenCalled();
  });

  it('moves failed renewals to dead-letter queue', async () => {
    (renewalExecutor.executeRenewal as jest.Mock).mockResolvedValue({
      success: false,
      subscriptionId: 'sub-1',
      failureReason: 'contract_failure',
      error: 'RPC timeout',
    });

    const result = await orchestrator.executeIdempotentRenewal(request);

    expect(result.success).toBe(false);
    expect(renewalDeadLetterService.moveToDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        failureReason: 'contract_failure',
      }),
    );
  });

  it('resolves billing date from subscription when not provided', async () => {
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { next_billing_date: '2026-07-01' },
        error: null,
      }),
    });
    (renewalExecutor.executeRenewal as jest.Mock).mockResolvedValue({ success: true, subscriptionId: 'sub-1' });

    const { billingDate: _billingDate, ...reqWithoutDate } = request;
    await orchestrator.executeIdempotentRenewal(reqWithoutDate);

    expect(supabase.from).toHaveBeenCalledWith('subscriptions');
  });
});
