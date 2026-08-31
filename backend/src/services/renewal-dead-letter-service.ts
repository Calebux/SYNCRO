import { supabase } from '../config/database';
import logger from '../config/logger';

export interface RenewalDeadLetterEntry {
  id: string;
  subscription_id: string;
  user_id: string;
  cycle_id: number;
  idempotency_key: string;
  approval_id: string | null;
  amount: number | null;
  failure_count: number;
  last_error_message: string | null;
  last_failure_reason: string | null;
  dead_letter_at: string;
  created_at: string;
  updated_at: string;
}

export interface RenewalAttemptRecord {
  id: string;
  subscription_id: string;
  user_id: string;
  cycle_id: number;
  idempotency_key: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'skipped';
  lock_holder: string | null;
  result: unknown;
  created_at: string;
  updated_at: string;
}

/**
 * Dead-letter queue for stuck or repeatedly failed renewal executions.
 */
export class RenewalDeadLetterService {
  async recordAttempt(params: {
    subscriptionId: string;
    userId: string;
    cycleId: number;
    idempotencyKey: string;
    lockHolder: string;
  }): Promise<RenewalAttemptRecord | null> {
    const { data, error } = await supabase
      .from('renewal_attempts')
      .insert({
        subscription_id: params.subscriptionId,
        user_id: params.userId,
        cycle_id: params.cycleId,
        idempotency_key: params.idempotencyKey,
        status: 'processing',
        lock_holder: params.lockHolder,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await supabase
          .from('renewal_attempts')
          .select('*')
          .eq('idempotency_key', params.idempotencyKey)
          .single();
        return existing as RenewalAttemptRecord | null;
      }
      logger.error('[RenewalDLQ] Failed to record attempt', { error });
      return null;
    }

    return data as RenewalAttemptRecord;
  }

  async updateAttemptStatus(
    idempotencyKey: string,
    status: RenewalAttemptRecord['status'],
    result?: unknown,
  ): Promise<void> {
    const { error } = await supabase
      .from('renewal_attempts')
      .update({
        status,
        result: result ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('idempotency_key', idempotencyKey);

    if (error) {
      logger.error('[RenewalDLQ] Failed to update attempt status', { idempotencyKey, error });
    }
  }

  async getAttemptByKey(idempotencyKey: string): Promise<RenewalAttemptRecord | null> {
    const { data, error } = await supabase
      .from('renewal_attempts')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error) {
      logger.error('[RenewalDLQ] Failed to fetch attempt', { idempotencyKey, error });
      return null;
    }

    return data as RenewalAttemptRecord | null;
  }

  async moveToDeadLetter(params: {
    subscriptionId: string;
    userId: string;
    cycleId: number;
    idempotencyKey: string;
    approvalId?: string;
    amount?: number;
    failureReason: string;
    errorMessage?: string;
  }): Promise<RenewalDeadLetterEntry> {
    const { data: existing } = await supabase
      .from('renewal_dead_letter_queue')
      .select('id, failure_count')
      .eq('idempotency_key', params.idempotencyKey)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from('renewal_dead_letter_queue')
        .update({
          failure_count: (existing.failure_count ?? 0) + 1,
          last_failure_reason: params.failureReason,
          last_error_message: params.errorMessage ?? null,
          dead_letter_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      logger.warn('[RenewalDLQ] Updated existing DLQ entry', { id: existing.id });
      return data as RenewalDeadLetterEntry;
    }

    const { data, error } = await supabase
      .from('renewal_dead_letter_queue')
      .insert({
        subscription_id: params.subscriptionId,
        user_id: params.userId,
        cycle_id: params.cycleId,
        idempotency_key: params.idempotencyKey,
        approval_id: params.approvalId ?? null,
        amount: params.amount ?? null,
        last_failure_reason: params.failureReason,
        last_error_message: params.errorMessage ?? null,
      })
      .select()
      .single();

    if (error) {
      logger.error('[RenewalDLQ] Failed to move to dead-letter', { error });
      throw error;
    }

    logger.warn('[RenewalDLQ] Renewal moved to dead-letter', {
      subscriptionId: params.subscriptionId,
      cycleId: params.cycleId,
    });

    return data as RenewalDeadLetterEntry;
  }

  async getUserDeadLetters(userId: string): Promise<RenewalDeadLetterEntry[]> {
    const { data, error } = await supabase
      .from('renewal_dead_letter_queue')
      .select('*')
      .eq('user_id', userId)
      .order('dead_letter_at', { ascending: false });

    if (error) {
      logger.error('[RenewalDLQ] Failed to fetch user DLQ entries', { error });
      throw error;
    }

    return (data ?? []) as RenewalDeadLetterEntry[];
  }

  async getDeadLetterStats(): Promise<{
    total: number;
    last_24h: number;
    last_7d: number;
  }> {
    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [totalRes, last24hRes, last7dRes] = await Promise.all([
      supabase.from('renewal_dead_letter_queue').select('id', { count: 'exact', head: true }),
      supabase
        .from('renewal_dead_letter_queue')
        .select('id', { count: 'exact', head: true })
        .gte('dead_letter_at', since24h),
      supabase
        .from('renewal_dead_letter_queue')
        .select('id', { count: 'exact', head: true })
        .gte('dead_letter_at', since7d),
    ]);

    return {
      total: totalRes.count ?? 0,
      last_24h: last24hRes.count ?? 0,
      last_7d: last7dRes.count ?? 0,
    };
  }
}

export const renewalDeadLetterService = new RenewalDeadLetterService();
