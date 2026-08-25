import logger from '../config/logger';
import { supabase } from '../config/database';
import { blockchainService } from './blockchain-service';

export interface BatchConfig {
  /** Minimum items before a batch is flushed (unless maxWaitMs elapsed). */
  minBatchSize: number;
  /** Hard cap on items per on-chain submission — never exceeded. */
  maxBatchSize: number;
  /** Flush aged pending rows even if below minBatchSize. */
  maxWaitMs: number;
  /**
   * Max pending rows allowed in the queue. Enqueue fails with backpressure
   * when depth would exceed this — prevents unbounded in-memory / DB growth.
   */
  maxQueueDepth: number;
  /** Max concurrent submitBatch calls (in-flight). Extra processPending calls no-op. */
  maxInFlightBatches: number;
}

export interface PendingSettlement {
  id: string;
  userId: string;
  subscriptionId: string;
  amount: number;
  settlementType: 'renewal' | 'channel_close';
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SettlementBatchMetrics {
  enqueued: number;
  processed: number;
  batchesSubmitted: number;
  backpressureRejections: number;
  lastBatchSize: number;
  lastQueueDepth: number;
  inFlightBatches: number;
}

export class SettlementBackpressureError extends Error {
  readonly code = 'SETTLEMENT_BACKPRESSURE';
  constructor(
    message: string,
    public readonly queueDepth: number,
    public readonly maxQueueDepth: number,
  ) {
    super(message);
    this.name = 'SettlementBackpressureError';
  }
}

const DEFAULT_CONFIG: BatchConfig = {
  minBatchSize: Number(process.env.SETTLEMENT_MIN_BATCH ?? 3),
  maxBatchSize: Number(process.env.SETTLEMENT_MAX_BATCH ?? 20),
  maxWaitMs: Number(process.env.SETTLEMENT_MAX_WAIT_MS ?? 5 * 60 * 1000),
  maxQueueDepth: Number(process.env.SETTLEMENT_MAX_QUEUE_DEPTH ?? 500),
  maxInFlightBatches: Number(process.env.SETTLEMENT_MAX_IN_FLIGHT ?? 2),
};

export class SettlementBatcher {
  private config: BatchConfig;
  private inFlight = 0;
  private metrics: SettlementBatchMetrics = {
    enqueued: 0,
    processed: 0,
    batchesSubmitted: 0,
    backpressureRejections: 0,
    lastBatchSize: 0,
    lastQueueDepth: 0,
    inFlightBatches: 0,
  };

  constructor(config: Partial<BatchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Guard against misconfiguration that would allow unbounded batches
    if (this.config.maxBatchSize < 1) this.config.maxBatchSize = 1;
    if (this.config.minBatchSize > this.config.maxBatchSize) {
      this.config.minBatchSize = this.config.maxBatchSize;
    }
    if (this.config.maxQueueDepth < this.config.maxBatchSize) {
      this.config.maxQueueDepth = this.config.maxBatchSize;
    }
  }

  getConfig(): Readonly<BatchConfig> {
    return { ...this.config };
  }

  getMetrics(): Readonly<SettlementBatchMetrics> {
    return { ...this.metrics, inFlightBatches: this.inFlight };
  }

  resetMetrics(): void {
    this.metrics = {
      enqueued: 0,
      processed: 0,
      batchesSubmitted: 0,
      backpressureRejections: 0,
      lastBatchSize: 0,
      lastQueueDepth: 0,
      inFlightBatches: 0,
    };
  }

  /** Current pending count in DB (status=pending). */
  async getQueueDepth(): Promise<number> {
    const { count, error } = await supabase
      .from('pending_settlements')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) throw error;
    const depth = count ?? 0;
    this.metrics.lastQueueDepth = depth;
    return depth;
  }

  async enqueue(settlement: Omit<PendingSettlement, 'id' | 'createdAt'>): Promise<string> {
    const depth = await this.getQueueDepth();
    if (depth >= this.config.maxQueueDepth) {
      this.metrics.backpressureRejections += 1;
      logger.warn('Settlement enqueue rejected — queue depth at cap', {
        depth,
        maxQueueDepth: this.config.maxQueueDepth,
      });
      throw new SettlementBackpressureError(
        `Settlement queue at capacity (${depth}/${this.config.maxQueueDepth})`,
        depth,
        this.config.maxQueueDepth,
      );
    }

    const { data, error } = await supabase
      .from('pending_settlements')
      .insert({
        user_id: settlement.userId,
        subscription_id: settlement.subscriptionId,
        amount: settlement.amount,
        settlement_type: settlement.settlementType,
        payload: settlement.payload,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) throw error;
    this.metrics.enqueued += 1;
    this.metrics.lastQueueDepth = depth + 1;
    logger.info('Settlement queued', {
      id: data.id,
      subscriptionId: settlement.subscriptionId,
      queueDepth: depth + 1,
    });
    return data.id;
  }

  async getPendingBatch(): Promise<PendingSettlement[]> {
    const cutoff = new Date(Date.now() - this.config.maxWaitMs).toISOString();

    const { data: aged } = await supabase
      .from('pending_settlements')
      .select('*')
      .eq('status', 'pending')
      .lte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(this.config.maxBatchSize);

    const { data: recent } = await supabase
      .from('pending_settlements')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(this.config.maxBatchSize);

    const pending = (recent ?? []) as Array<Record<string, unknown>>;
    const oldestPending = pending.length > 0 ? (pending[0]!.created_at as string) : null;
    const waitExpired = oldestPending ? new Date(oldestPending) <= new Date(cutoff) : false;

    if (pending.length < this.config.minBatchSize && !waitExpired) {
      return [];
    }

    const raw = (aged && aged.length > 0 ? aged : pending) as Array<Record<string, unknown>>;
    // Hard bound — never return more than maxBatchSize
    const bounded = raw.slice(0, this.config.maxBatchSize);
    return this.shuffle(bounded.map(this.toPending));
  }

  async submitBatch(batch: PendingSettlement[]): Promise<{ batchId: string; txHash?: string }> {
    if (batch.length === 0) return { batchId: '' };

    // Enforce bound even if caller passes a larger array
    const capped = batch.slice(0, this.config.maxBatchSize);
    const batchId = `batch_${Date.now()}_${capped.length}`;
    const shuffled = this.shuffle([...capped]);

    logger.info('Submitting settlement batch', {
      batchId,
      count: shuffled.length,
      maxBatchSize: this.config.maxBatchSize,
      subscriptionIds: shuffled.map((s) => s.subscriptionId),
    });

    let txHash: string | undefined;
    try {
      const result = await blockchainService.syncSubscription(
        batchId,
        batchId,
        'update',
        {
          type: 'batch_settlement',
          settlements: shuffled.map((s) => ({
            subscriptionId: s.subscriptionId,
            amount: s.amount,
            type: s.settlementType,
          })),
        },
      );
      txHash = result.transactionHash;
    } catch (err) {
      logger.error('Batch settlement on-chain failed', { batchId, error: err });
    }

    const ids = shuffled.map((s) => s.id);
    await supabase
      .from('pending_settlements')
      .update({
        status: 'submitted',
        batch_id: batchId,
        transaction_hash: txHash ?? null,
        submitted_at: new Date().toISOString(),
      })
      .in('id', ids);

    this.metrics.batchesSubmitted += 1;
    this.metrics.processed += shuffled.length;
    this.metrics.lastBatchSize = shuffled.length;

    return { batchId, txHash };
  }

  async processPending(): Promise<{ processed: number; batchId?: string; skipped?: string }> {
    if (this.inFlight >= this.config.maxInFlightBatches) {
      logger.info('Settlement processPending skipped — in-flight cap reached', {
        inFlight: this.inFlight,
        maxInFlightBatches: this.config.maxInFlightBatches,
      });
      return { processed: 0, skipped: 'in_flight_cap' };
    }

    this.inFlight += 1;
    try {
      const batch = await this.getPendingBatch();
      if (batch.length === 0) return { processed: 0 };

      const { batchId } = await this.submitBatch(batch);
      return { processed: batch.length, batchId };
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
  }

  /** Fisher-Yates shuffle to randomize order within batch */
  private shuffle<T>(items: T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }

  private toPending(row: Record<string, unknown>): PendingSettlement {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      subscriptionId: row.subscription_id as string,
      amount: Number(row.amount),
      settlementType: row.settlement_type as PendingSettlement['settlementType'],
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: row.created_at as string,
    };
  }
}

export const settlementBatcher = new SettlementBatcher();
