import { Keypair, xdr } from '@stellar/stellar-sdk';
import {
  ChainSubmissionClient,
  MaxFeeExceededError,
  AmbiguousTimeoutError,
} from '../src/blockchain/chain-submission-client';

// Mock Stellar SDK SorobanRpc Server
const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  const mockServerInstance = {
    getAccount: (...args: any[]) => mockGetAccount(...args),
    simulateTransaction: (...args: any[]) => mockSimulateTransaction(...args),
    sendTransaction: (...args: any[]) => mockSendTransaction(...args),
    getTransaction: (...args: any[]) => mockGetTransaction(...args),
  };
  const mockRpcObject = {
    ...original.rpc,
    Server: jest.fn().mockImplementation(() => mockServerInstance),
    assembleTransaction: jest.fn().mockReturnValue({
      build: jest.fn().mockReturnValue({
        sign: jest.fn(),
        hash: jest.fn().mockReturnValue(Buffer.from('mock-tx-hash-12345', 'utf-8')),
      }),
    }),
    Api: {
      isSimulationError: jest.fn().mockReturnValue(false),
      GetTransactionStatus: {
        SUCCESS: 'SUCCESS',
        FAILED: 'FAILED',
        NOT_FOUND: 'NOT_FOUND',
      },
    },
  };

  return {
    ...original,
    rpc: mockRpcObject,
    SorobanRpc: mockRpcObject,
  };
});

describe('ChainSubmissionClient', () => {
  let client: ChainSubmissionClient;
  const testKeypair = Keypair.random();
  const testPublicKey = testKeypair.publicKey();

  jest.setTimeout(15000);

  beforeEach(() => {
    jest.clearAllMocks();

    client = new ChainSubmissionClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      initialFeeStroops: 100,
      maxAcceptableFeeStroops: 1000,
      feeMultiplier: 2.0,
      timeoutMs: 1000,
      maxRetries: 3,
    });

    // Default mock behavior
    mockGetAccount.mockResolvedValue({
      sequenceNumber: () => '100',
    });

    mockSimulateTransaction.mockResolvedValue({
      result: { retval: xdr.ScVal.scvVoid() },
    });

    mockSendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: 'mock-tx-hash-12345',
    });

    mockGetTransaction.mockResolvedValue({
      status: 'SUCCESS',
    });
  });

  describe('Centralized Sequence Number Management (Concurrency Protection)', () => {
    it('prevents sequence collisions by locking and advancing sequence numbers sequentially for concurrent callers', async () => {
      let seqCounter = 100;
      mockGetAccount.mockImplementation(async () => {
        return { sequenceNumber: () => seqCounter.toString() };
      });

      const submissions = Array.from({ length: 5 }, (_, i) =>
        client.submit({
          sourceKeypair: testKeypair,
          method: 'test_method',
          args: [],
          idempotencyKey: `req_${i}`,
        })
      );

      const results = await Promise.all(submissions);

      expect(results).toHaveLength(5);
      results.forEach((res) => {
        expect(res.status).toBe('SUCCESS');
      });

      // getAccount should only be called once to initialize sequence
      expect(mockGetAccount).toHaveBeenCalledTimes(1);

      // Sequence numbers returned should be sequential: 101, 102, 103, 104, 105
      const sequences = results.map((r) => r.sequenceNumber);
      expect(sequences).toEqual(['101', '102', '103', '104', '105']);
    });

    it('invalidates and refetches sequence from RPC when a sequence error occurs', async () => {
      mockGetAccount.mockResolvedValueOnce({
        sequenceNumber: () => '100',
      });

      // First call fails with sequence error (e.g. bad_seq)
      mockSendTransaction
        .mockResolvedValueOnce({
          status: 'ERROR',
          errorResult: 'txBAD_SEQ',
        })
        .mockResolvedValueOnce({
          status: 'PENDING',
          hash: 'mock-tx-hash-recovered',
        });

      mockGetAccount.mockResolvedValueOnce({
        sequenceNumber: () => '105',
      });

      const result = await client.submit({
        sourceKeypair: testKeypair,
        method: 'test_method',
        args: [],
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.transactionHash).toBe('mock-tx-hash-recovered');
      // getAccount called again after sequence cache invalidation
      expect(mockGetAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe('Induced Congestion & Fee Bumping', () => {
    it('survives an induced congestion test by bumping transaction fee on congestion/insufficient fee errors without double-submitting', async () => {
      let attemptCount = 0;
      const sentFees: number[] = [];

      mockSendTransaction.mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          return { status: 'ERROR', errorResult: 'txINSUFFICIENT_FEE' };
        }
        if (attemptCount === 2) {
          return { status: 'ERROR', errorResult: 'txTOO_LATE (ledger congestion)' };
        }
        return { status: 'PENDING', hash: 'mock-tx-hash-bumped' };
      });

      const result = await client.submit({
        sourceKeypair: testKeypair,
        method: 'value_transfer',
        args: [],
      });

      expect(result.status).toBe('SUCCESS');
      expect(attemptCount).toBe(3);
      // Initial fee: 100, Attempt 2 fee: 200 (100*2), Attempt 3 fee: 400 (200*2)
      expect(result.feePaidStroops).toBe(400);
      expect(result.transactionHash).toBe('mock-tx-hash-bumped');
    });

    it('throws MaxFeeExceededError when fee bumping exceeds maxAcceptableFeeStroops', async () => {
      client = new ChainSubmissionClient({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        initialFeeStroops: 500,
        maxAcceptableFeeStroops: 800,
        feeMultiplier: 2.0,
        timeoutMs: 1000,
        maxRetries: 3,
      });

      mockSendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: 'txINSUFFICIENT_FEE',
      });

      await expect(
        client.submit({
          sourceKeypair: testKeypair,
          method: 'high_fee_call',
          args: [],
        })
      ).rejects.toThrow(MaxFeeExceededError);
    });
  });

  describe('Ambiguous Timeout Ledger Querying (Never Blind-Retry Value-Moving Calls)', () => {
    it('queries ledger fate on ambiguous timeout and returns success if transaction landed, preventing double submission', async () => {
      // Simulate sendTransaction timing out or throwing ambiguous network error
      mockSendTransaction.mockRejectedValueOnce(new Error('Network gateway timeout (504)'));

      // Ledger query returns SUCCESS for the signed transaction hash
      mockGetTransaction.mockResolvedValueOnce({
        status: 'SUCCESS',
      });

      const result = await client.submit({
        sourceKeypair: testKeypair,
        method: 'transfer_funds',
        args: [],
      });

      // Verification:
      // 1. Result succeeds based on ledger fate confirmation
      expect(result.status).toBe('SUCCESS');
      // 2. sendTransaction was ONLY called ONCE (no double-submitting / no blind retry)
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);
      // 3. getTransaction was queried to check the transaction fate on-chain
      expect(mockGetTransaction).toHaveBeenCalledWith(expect.any(String));
    });

    it('queries ledger fate on confirmation timeout and returns success if confirmed on-chain', async () => {
      mockSendTransaction.mockResolvedValueOnce({
        status: 'PENDING',
        hash: 'tx-ambiguous-timeout-hash',
      });

      // waitForConfirmation throws AmbiguousTimeoutError (timeout waiting for status)
      mockGetTransaction
        .mockResolvedValueOnce({ status: 'NOT_FOUND' })
        .mockRejectedValueOnce(new AmbiguousTimeoutError('Timeout waiting for confirmation'))
        // Subsequent ledger query confirms transaction landed
        .mockResolvedValueOnce({ status: 'SUCCESS' });

      const result = await client.submit({
        sourceKeypair: testKeypair,
        method: 'pay_subscription',
        args: [],
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.transactionHash).toBe('tx-ambiguous-timeout-hash');
    });
  });

  describe('Application-Layer Idempotency', () => {
    it('deduplicates concurrent inflight requests with identical idempotencyKey', async () => {
      let sendCallCount = 0;
      mockSendTransaction.mockImplementation(async () => {
        sendCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { status: 'PENDING', hash: 'tx-hash-singleflight' };
      });

      const key = 'idem_key_concurrent_123';

      const [res1, res2] = await Promise.all([
        client.submit({
          sourceKeypair: testKeypair,
          method: 'execute_payout',
          args: [],
          idempotencyKey: key,
        }),
        client.submit({
          sourceKeypair: testKeypair,
          method: 'execute_payout',
          args: [],
          idempotencyKey: key,
        }),
      ]);

      expect(sendCallCount).toBe(1); // Only 1 real chain submission executed
      expect(res1.transactionHash).toBe('tx-hash-singleflight');
      expect(res2.wasDuplicate).toBe(true);
    });

    it('returns cached completed result for duplicate idempotencyKey without re-submitting', async () => {
      const key = 'idem_key_repeat_456';

      const res1 = await client.submit({
        sourceKeypair: testKeypair,
        method: 'renew_subscription',
        args: [],
        idempotencyKey: key,
      });

      expect(res1.wasDuplicate).toBeUndefined();
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);

      const res2 = await client.submit({
        sourceKeypair: testKeypair,
        method: 'renew_subscription',
        args: [],
        idempotencyKey: key,
      });

      expect(res2.wasDuplicate).toBe(true);
      expect(res2.transactionHash).toBe(res1.transactionHash);
      // No extra RPC calls
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
