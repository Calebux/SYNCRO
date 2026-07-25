import logger from '../config/logger';
import { supabase } from '../config/database';
import { blockchainService } from './blockchain-service';

export interface BatchConfig {
  minBatchSize: number;
  maxBatchSize: number;
  maxWaitMs: number;
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

const DEFAULT_CONFIG: BatchConfig = {
  minBatchSize: Number(process.env.SETTLEMENT_MIN_BATCH ?? 3),
  maxBatchSize: Number(process.env.SETTLEMENT_MAX_BATCH ?? 20),
  maxWaitMs: Number(process.env.SETTLEMENT_MAX_WAIT_MS ?? 5 * 60 * 1000),
};

export class SettlementBatcher {
  private config: BatchConfig;

  constructor(config: Partial<BatchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async enqueue(settlement: Omit<PendingSettlement, 'id' | 'createdAt'>): Promise<string> {
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
    logger.info('Settlement queued', { id: data.id, subscriptionId: settlement.subscriptionId });
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
    const oldestPending = pending.length > 0 ? pending[0]!.created_at as string : null;
    const waitExpired = oldestPending ? new Date(oldestPending) <= new Date(cutoff) : false;

    if (pending.length < this.config.minBatchSize && !waitExpired) {
      return [];
    }

    const batch = (aged && aged.length > 0 ? aged : pending.slice(0, this.config.maxBatchSize)) as Array<Record<string, unknown>>;
    return this.shuffle(batch.map(this.toPending));
  }

  async submitBatch(batch: PendingSettlement[]): Promise<{ batchId: string; txHash?: string }> {
    if (batch.length === 0) return { batchId: '' };

    const batchId = `batch_${Date.now()}_${batch.length}`;
    const shuffled = this.shuffle([...batch]);

    logger.info('Submitting settlement batch', {
      batchId,
      count: shuffled.length,
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

    return { batchId, txHash };
  }

  async processPending(): Promise<{ processed: number; batchId?: string }> {
    const batch = await this.getPendingBatch();
    if (batch.length === 0) return { processed: 0 };

    const { batchId } = await this.submitBatch(batch);
    return { processed: batch.length, batchId };
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
