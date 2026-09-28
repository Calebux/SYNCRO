import { supabase } from '../../config/database';
import logger from '../../config/logger';
import {
  RenewalSagaState,
  RenewalSagaStatus,
  RenewalSagaStepName,
} from './renewal-saga-types';

interface RenewalAttemptRow {
  attempt_id: string;
  idempotency_key: string;
  subscription_id: string;
  user_id: string;
  cycle_id: number;
  saga_status: RenewalSagaStatus;
  current_step: RenewalSagaStepName | null;
  completed_steps: RenewalSagaStepName[];
  step_context: Record<string, unknown>;
  step_started_at: string | null;
  worker_id: string | null;
  needs_manual_reconciliation: boolean;
  updated_at: string;
}

function toState(row: RenewalAttemptRow): RenewalSagaState {
  return {
    attemptId: row.attempt_id,
    idempotencyKey: row.idempotency_key,
    subscriptionId: row.subscription_id,
    userId: row.user_id,
    cycleId: row.cycle_id,
    sagaStatus: row.saga_status,
    currentStep: row.current_step,
    completedSteps: row.completed_steps ?? [],
    stepContext: row.step_context ?? {},
    stepStartedAt: row.step_started_at,
    workerId: row.worker_id,
    needsManualReconciliation: row.needs_manual_reconciliation,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS =
  'attempt_id, idempotency_key, subscription_id, user_id, cycle_id, saga_status, current_step, completed_steps, step_context, step_started_at, worker_id, needs_manual_reconciliation, updated_at';

export class RenewalSagaStateService {
  async getByIdempotencyKey(idempotencyKey: string): Promise<RenewalSagaState | null> {
    const { data, error } = await supabase
      .from('renewal_attempts')
      .select(SELECT_COLUMNS)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error) {
      logger.error('[RenewalSagaState] Failed to fetch by idempotency key', { idempotencyKey, error });
      return null;
    }
    return data ? toState(data as RenewalAttemptRow) : null;
  }

  async getByAttemptId(attemptId: string): Promise<RenewalSagaState | null> {
    const { data, error } = await supabase
      .from('renewal_attempts')
      .select(SELECT_COLUMNS)
      .eq('attempt_id', attemptId)
      .maybeSingle();

    if (error) {
      logger.error('[RenewalSagaState] Failed to fetch by attempt id', { attemptId, error });
      return null;
    }
    return data ? toState(data as RenewalAttemptRow) : null;
  }

  /**
   * Creates the attempt row if one doesn't exist for this idempotency key,
   * or returns the existing one (so a saga survives a process restart with
   * the same attemptId — the saga's unit of idempotency).
   */
  async getOrCreate(params: {
    subscriptionId: string;
    userId: string;
    cycleId: number;
    idempotencyKey: string;
    lockHolder: string;
  }): Promise<RenewalSagaState> {
    const { data, error } = await supabase
      .from('renewal_attempts')
      .insert({
        subscription_id: params.subscriptionId,
        user_id: params.userId,
        cycle_id: params.cycleId,
        idempotency_key: params.idempotencyKey,
        status: 'processing',
        lock_holder: params.lockHolder,
        saga_status: 'pending',
        current_step: null,
        completed_steps: [],
        step_context: {},
        worker_id: params.lockHolder,
      })
      .select(SELECT_COLUMNS)
      .single();

    if (!error) {
      return toState(data as RenewalAttemptRow);
    }

    // Unique violation on idempotency_key => an attempt already exists.
    if (error.code === '23505') {
      const existing = await this.getByIdempotencyKey(params.idempotencyKey);
      if (existing) return existing;
    }

    logger.error('[RenewalSagaState] Failed to create attempt', { error, params });
    throw error;
  }

  async markRunning(attemptId: string, workerId: string): Promise<void> {
    await this.update(attemptId, { saga_status: 'running', worker_id: workerId });
  }

  async advanceStep(
    attemptId: string,
    step: RenewalSagaStepName,
    completedSteps: RenewalSagaStepName[],
    stepContext: Record<string, unknown>,
    workerId: string,
  ): Promise<void> {
    await this.update(attemptId, {
      saga_status: 'running',
      current_step: step,
      completed_steps: completedSteps,
      step_context: stepContext,
      step_started_at: new Date().toISOString(),
      worker_id: workerId,
    });
  }

  async markCompensating(
    attemptId: string,
    step: RenewalSagaStepName | null,
    workerId: string,
  ): Promise<void> {
    await this.update(attemptId, {
      saga_status: 'compensating',
      current_step: step,
      step_started_at: new Date().toISOString(),
      worker_id: workerId,
    });
  }

  async markCompleted(attemptId: string): Promise<void> {
    await this.update(attemptId, {
      saga_status: 'completed',
      current_step: 'release',
      step_started_at: null,
    });
  }

  async markCompensated(attemptId: string): Promise<void> {
    await this.update(attemptId, {
      saga_status: 'compensated',
      step_started_at: null,
    });
  }

  async markDeadLettered(attemptId: string): Promise<void> {
    await this.update(attemptId, {
      saga_status: 'dead_lettered',
      step_started_at: null,
    });
  }

  async flagManualReconciliation(attemptId: string): Promise<void> {
    await this.update(attemptId, { needs_manual_reconciliation: true });
  }

  /** Sagas that have been sitting in an in-progress state past the heartbeat window. */
  async getStuckSagas(olderThanMs: number): Promise<RenewalSagaState[]> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();

    const { data, error } = await supabase
      .from('renewal_attempts')
      .select(SELECT_COLUMNS)
      .in('saga_status', ['running', 'compensating'])
      .lt('step_started_at', cutoff)
      .order('step_started_at', { ascending: true });

    if (error) {
      logger.error('[RenewalSagaState] Failed to fetch stuck sagas', { error });
      throw error;
    }

    return (data ?? []).map((row) => toState(row as RenewalAttemptRow));
  }

  /** For the ops dashboard: every saga currently in flight, with age. */
  async listInFlight(): Promise<Array<RenewalSagaState & { ageMs: number }>> {
    const { data, error } = await supabase
      .from('renewal_attempts')
      .select(SELECT_COLUMNS)
      .in('saga_status', ['pending', 'running', 'compensating'])
      .order('step_started_at', { ascending: true });

    if (error) {
      logger.error('[RenewalSagaState] Failed to list in-flight sagas', { error });
      throw error;
    }

    const now = Date.now();
    return (data ?? []).map((row) => {
      const state = toState(row as RenewalAttemptRow);
      const started = state.stepStartedAt ? new Date(state.stepStartedAt).getTime() : now;
      return { ...state, ageMs: now - started };
    });
  }

  private async update(attemptId: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await supabase
      .from('renewal_attempts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('attempt_id', attemptId);

    if (error) {
      logger.error('[RenewalSagaState] Failed to update attempt', { attemptId, patch, error });
      throw error;
    }
  }
}

export const renewalSagaStateService = new RenewalSagaStateService();