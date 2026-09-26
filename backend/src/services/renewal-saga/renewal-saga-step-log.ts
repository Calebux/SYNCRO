import { supabase } from '../../config/database';
import logger from '../../config/logger';
import { RenewalSagaStepName } from './renewal-saga-types';

type Direction = 'execute' | 'compensate';

/**
 * Durable per-(attempt, step, direction) log. This is what makes each
 * step idempotent across process restarts: before running a step (or its
 * compensation) the executor checks here first, and after running it
 * records the outcome here in the same call that advances saga state.
 */
export class RenewalSagaStepLog {
  async hasCompleted(attemptId: string, step: RenewalSagaStepName, direction: Direction): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabase
      .from('renewal_saga_step_log')
      .select('output, status')
      .eq('attempt_id', attemptId)
      .eq('step', step)
      .eq('direction', direction)
      .maybeSingle();

    if (error) {
      logger.error('[RenewalSagaStepLog] Failed to read step log', { attemptId, step, direction, error });
      return null;
    }

    if (data?.status === 'completed') {
      return (data.output as Record<string, unknown>) ?? {};
    }
    return null;
  }

  async recordCompleted(
    attemptId: string,
    step: RenewalSagaStepName,
    direction: Direction,
    output?: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await supabase.from('renewal_saga_step_log').upsert(
      {
        attempt_id: attemptId,
        step,
        direction,
        status: 'completed',
        output: output ?? {},
      },
      { onConflict: 'attempt_id,step,direction' },
    );

    if (error) {
      logger.error('[RenewalSagaStepLog] Failed to record step completion', { attemptId, step, direction, error });
      throw error;
    }
  }

  async recordFailed(
    attemptId: string,
    step: RenewalSagaStepName,
    direction: Direction,
    errorMessage: string,
  ): Promise<void> {
    const { error } = await supabase.from('renewal_saga_step_log').upsert(
      {
        attempt_id: attemptId,
        step,
        direction,
        status: 'failed',
        error_message: errorMessage,
      },
      { onConflict: 'attempt_id,step,direction' },
    );

    if (error) {
      logger.error('[RenewalSagaStepLog] Failed to record step failure', { attemptId, step, direction, error });
    }
  }
}

export const renewalSagaStepLog = new RenewalSagaStepLog();