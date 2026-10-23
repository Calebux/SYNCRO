import {
  Keypair,
  Account,
  TransactionBuilder,
  rpc as SorobanRpc,
  Contract,
  xdr,
  Memo,
} from '@stellar/stellar-sdk';
import logger from '../config/logger';

export interface ChainSubmissionConfig {
  rpcUrl: string;
  networkPassphrase: string;
  initialFeeStroops?: number;
  maxAcceptableFeeStroops?: number;
  feeMultiplier?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface SubmissionParams {
  sourceKeypair: Keypair;
  contractAddress?: string;
  method: string;
  args: xdr.ScVal[];
  memo?: string;
  idempotencyKey?: string;
}

export interface SubmissionResult {
  transactionHash: string;
  status: string;
  feePaidStroops: number;
  sequenceNumber: string;
  wasDuplicate?: boolean;
}

export class MaxFeeExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaxFeeExceededError';
  }
}

export class AmbiguousTimeoutError extends Error {
  constructor(message: string, public txHash?: string) {
    super(message);
    this.name = 'AmbiguousTimeoutError';
  }
}

/**
 * Centralized Chain Submission Client for Soroban/Stellar transactions.
 * Handled features:
 * 1. Sequence-number management across concurrent callers (prevents collisions).
 * 2. Dynamic fee bumping under network congestion up to maxAcceptableFee.
 * 3. Ambiguous timeout resolution by ledger querying before resubmission.
 * 4. Application-layer idempotency to detect and prevent duplicate submissions.
 */
export class ChainSubmissionClient {
  private rpcUrl: string;
  private networkPassphrase: string;
  private initialFeeStroops: number;
  private maxAcceptableFeeStroops: number;
  private feeMultiplier: number;
  private timeoutMs: number;
  private maxRetries: number;

  // Concurrency & sequence number management
  private accountSequences = new Map<string, bigint>();
  private accountLocks = new Map<string, Promise<void>>();

  // Idempotency tracking
  private inflightRequests = new Map<string, Promise<SubmissionResult>>();
  private completedSubmissions = new Map<string, SubmissionResult>();

  constructor(config: ChainSubmissionConfig) {
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.initialFeeStroops = config.initialFeeStroops ?? 100;
    this.maxAcceptableFeeStroops = config.maxAcceptableFeeStroops ?? 100000;
    this.feeMultiplier = config.feeMultiplier ?? 1.5;
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.maxRetries = config.maxRetries ?? 4;
  }

  /**
   * Submit a transaction to the Soroban network with sequence management,
   * fee bumping, timeout verification, and application-layer idempotency.
   */
  async submit(params: SubmissionParams): Promise<SubmissionResult> {
    const { idempotencyKey } = params;

    if (idempotencyKey) {
      // 1. Check completed idempotency cache
      if (this.completedSubmissions.has(idempotencyKey)) {
        logger.info('Duplicate submission detected from completed cache', { idempotencyKey });
        const cached = this.completedSubmissions.get(idempotencyKey)!;
        return { ...cached, wasDuplicate: true };
      }

      // 2. Check inflight request (single-flight pattern)
      if (this.inflightRequests.has(idempotencyKey)) {
        logger.info('Deduplicating inflight submission request', { idempotencyKey });
        const result = await this.inflightRequests.get(idempotencyKey)!;
        return { ...result, wasDuplicate: true };
      }
    }

    const submissionPromise = this.executeSubmission(params);

    if (idempotencyKey) {
      this.inflightRequests.set(idempotencyKey, submissionPromise);
    }

    try {
      const result = await submissionPromise;
      if (idempotencyKey) {
        this.completedSubmissions.set(idempotencyKey, result);
      }
      return result;
    } finally {
      if (idempotencyKey) {
        this.inflightRequests.delete(idempotencyKey);
      }
    }
  }

  private async executeSubmission(params: SubmissionParams): Promise<SubmissionResult> {
    const { sourceKeypair, contractAddress, method, args, memo } = params;
    const publicKey = sourceKeypair.publicKey();
    const rpc = new SorobanRpc.Server(this.rpcUrl);

    let currentFee = this.initialFeeStroops;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let signedTxHash: string | undefined;
      let usedSequence: bigint | undefined;

      try {
        // Run sequence-locked block to build & increment sequence number safely
        const { assembledTx, txHash, sequence } = await this.withAccountLock(publicKey, async () => {
          const seq = await this.getOrFetchSequence(rpc, publicKey);
          usedSequence = seq + 1n;

          const account = new Account(publicKey, seq.toString());
          let builder = new TransactionBuilder(account, {
            fee: currentFee.toString(),
            networkPassphrase: this.networkPassphrase,
          });

          if (contractAddress) {
            const contract = new Contract(contractAddress);
            builder = builder.addOperation(contract.call(method, ...args));
          }

          if (memo) {
            builder = builder.addMemo(Memo.text(memo));
          }

          builder = builder.setTimeout(Math.floor(this.timeoutMs / 1000));
          const tx = builder.build();

          // Simulate transaction
          const sim = await rpc.simulateTransaction(tx);
          if (SorobanRpc.Api.isSimulationError(sim)) {
            throw new Error(`Simulation failed: ${sim.error}`);
          }

          const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
          assembled.sign(sourceKeypair);

          // Advance in-memory sequence number ONLY after successful building
          this.accountSequences.set(publicKey, seq + 1n);

          return {
            assembledTx: assembled,
            txHash: assembled.hash().toString('hex'),
            sequence: seq + 1n,
          };
        });

        signedTxHash = txHash;

        // Send transaction to ledger
        let sendResult;
        try {
          sendResult = await rpc.sendTransaction(assembledTx);
        } catch (sendError) {
          // If sending threw a timeout or network failure, query ledger fate before any retry!
          if (this.isTimeoutError(sendError) && signedTxHash) {
            logger.warn('Ambiguous timeout sending transaction. Querying ledger fate...', {
              txHash: signedTxHash,
              method,
            });
            const ledgerResult = await this.queryLedgerFate(rpc, signedTxHash);
            if (ledgerResult) {
              return {
                transactionHash: signedTxHash,
                status: ledgerResult.status,
                feePaidStroops: currentFee,
                sequenceNumber: usedSequence.toString(),
              };
            }
          }
          throw sendError;
        }

        if (sendResult.status === 'ERROR') {
          const errorMsg = String(sendResult.errorResult || 'Unknown send error');
          if (this.isSequenceError(errorMsg)) {
            this.invalidateSequence(publicKey);
          }
          if (this.isFeeError(errorMsg) || this.isCongestionError(errorMsg)) {
            currentFee = this.bumpFee(currentFee);
            continue;
          }
          throw new Error(`Send transaction failed: ${errorMsg}`);
        }

        const finalTxHash = sendResult.hash || signedTxHash;

        // Poll transaction status with ambiguous timeout protection
        try {
          const confirmedResult = await this.waitForConfirmation(rpc, finalTxHash);
          return {
            transactionHash: finalTxHash,
            status: confirmedResult.status,
            feePaidStroops: currentFee,
            sequenceNumber: usedSequence.toString(),
          };
        } catch (confirmError) {
          if (this.isTimeoutError(confirmError)) {
            logger.warn('Ambiguous timeout waiting for transaction confirmation. Querying ledger fate...', {
              txHash: finalTxHash,
              method,
            });
            const ledgerResult = await this.queryLedgerFate(rpc, finalTxHash);
            if (ledgerResult) {
              return {
                transactionHash: finalTxHash,
                status: ledgerResult.status,
                feePaidStroops: currentFee,
                sequenceNumber: usedSequence.toString(),
              };
            }
          }
          throw confirmError;
        }
      } catch (err: any) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Sequence error -> reset cached sequence and retry
        if (this.isSequenceError(errorMsg)) {
          logger.warn('Sequence collision/error detected. Invalidating sequence cache...', { publicKey, attempt });
          this.invalidateSequence(publicKey);
        } else if (this.isFeeError(errorMsg) || this.isCongestionError(errorMsg)) {
          // Congestion / fee error -> bump fee and retry
          logger.warn('Fee error or congestion detected. Bumping fee...', { currentFee, attempt });
          currentFee = this.bumpFee(currentFee);
        } else if (attempt === this.maxRetries) {
          throw err;
        }

        if (attempt === this.maxRetries) {
          throw err;
        }

        await this.sleep(Math.pow(2, attempt) * 250);
      }
    }

    throw new Error(`Chain submission failed after ${this.maxRetries} attempts`);
  }

  /**
   * Query ledger for a transaction's fate to avoid blind retries of value-moving calls.
   */
  private async queryLedgerFate(
    rpc: SorobanRpc.Server,
    txHash: string
  ): Promise<{ status: string } | null> {
    try {
      const getTx = await rpc.getTransaction(txHash);
      if (getTx.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS || getTx.status === 'SUCCESS') {
        logger.info('Ledger query confirmed transaction landed successfully on-chain', { txHash });
        return { status: 'SUCCESS' };
      }
      if (getTx.status === SorobanRpc.Api.GetTransactionStatus.FAILED || getTx.status === 'FAILED') {
        logger.warn('Ledger query confirmed transaction landed on-chain but failed', { txHash });
        return { status: 'FAILED' };
      }
    } catch (err) {
      logger.error('Failed to query ledger fate for transaction:', { txHash, err });
    }
    return null;
  }

  private async waitForConfirmation(rpc: SorobanRpc.Server, txHash: string): Promise<{ status: string }> {
    const startTime = Date.now();
    const pollInterval = 500;
    while (Date.now() - startTime < this.timeoutMs) {
      const getTx = await rpc.getTransaction(txHash);
      if (getTx.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS || getTx.status === 'SUCCESS') {
        return { status: 'SUCCESS' };
      }
      if (getTx.status === SorobanRpc.Api.GetTransactionStatus.FAILED || getTx.status === 'FAILED') {
        throw new Error(`Transaction failed on-chain: ${txHash}`);
      }
      if (getTx.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND || getTx.status === 'NOT_FOUND') {
        await this.sleep(pollInterval);
        continue;
      }
    }
    throw new AmbiguousTimeoutError(`Timeout waiting for transaction confirmation: ${txHash}`, txHash);
  }

  private bumpFee(currentFee: number): number {
    if (currentFee >= this.maxAcceptableFeeStroops) {
      throw new MaxFeeExceededError(
        `Transaction fee of ${currentFee} stroops has reached the maximum acceptable fee limit of ${this.maxAcceptableFeeStroops} stroops`
      );
    }
    const nextFee = Math.ceil(currentFee * this.feeMultiplier);
    if (nextFee > this.maxAcceptableFeeStroops) {
      return this.maxAcceptableFeeStroops;
    }
    return nextFee;
  }

  private async getOrFetchSequence(rpc: SorobanRpc.Server, publicKey: string): Promise<bigint> {
    if (this.accountSequences.has(publicKey)) {
      return this.accountSequences.get(publicKey)!;
    }
    const account = await rpc.getAccount(publicKey);
    const seq = BigInt(account.sequenceNumber());
    this.accountSequences.set(publicKey, seq);
    return seq;
  }

  private invalidateSequence(publicKey: string): void {
    this.accountSequences.delete(publicKey);
  }

  private async withAccountLock<T>(publicKey: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = this.accountLocks.get(publicKey) || Promise.resolve();
    let releaseLock: () => void = () => {};

    const newLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.accountLocks.set(
      publicKey,
      currentLock.then(() => newLock)
    );

    await currentLock;
    try {
      return await fn();
    } finally {
      releaseLock();
    }
  }

  private isSequenceError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return (
      lower.includes('bad_seq') ||
      lower.includes('txbad_seq') ||
      lower.includes('sequence_no_too_low') ||
      lower.includes('sequence_no_too_high') ||
      lower.includes('sequence')
    );
  }

  private isFeeError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return (
      lower.includes('insufficient_fee') ||
      lower.includes('txinsufficient_fee') ||
      lower.includes('fee_too_low') ||
      lower.includes('fee')
    );
  }

  private isCongestionError(msg: string): boolean {
    const lower = msg.toLowerCase();
    return (
      lower.includes('congestion') ||
      lower.includes('txtoo_late') ||
      lower.includes('too_late') ||
      lower.includes('busy')
    );
  }

  private isTimeoutError(err: unknown): boolean {
    if (err instanceof AmbiguousTimeoutError) return true;
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    return msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnreset') || msg.includes('504') || msg.includes('502');
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reset in-memory cached state (useful for tests)
   */
  public resetState(): void {
    this.accountSequences.clear();
    this.accountLocks.clear();
    this.inflightRequests.clear();
    this.completedSubmissions.clear();
  }
}
