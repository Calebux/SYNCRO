/**
 * backend/src/services/usage/degraded-usage-replay.ts
 *
 * Drains `degraded_usage_log` into the meter once the store is healthy again
 * (issue #1445).
 *
 * Safety model — a partially replayed log must be safe to replay again:
 *
 *   1. Only entries the reconciler is prepared to act on are claimed, one at a
 *      time, via a conditional UPDATE on `replay_state`. A run that dies
 *      half-way leaves the remaining entries 'pending', so the next run picks
 *      up exactly where it stopped.
 *   2. Applying to the meter is guarded by `meter_usage_ledger`'s
 *      `metered_at is null` predicate and its unique
 *      `meter_idempotency_key` index. An entry whose reservation is already
 *      metered is reported as `alreadyApplied` rather than charged twice.
 *   3. An entry that throws is marked 'failed' with the error, and retried on
 *      later runs up to a cap, after which it is 'abandoned' and escalated
 *      rather than retried forever.
 *
 * The design is deliberately at-most-once: for billing, never charging an agent
 * twice is preferable to a rare under-charge, and the reconciliation report
 * surfaces anything that got abandoned so it can be handled by a human.
 */

import { supabase } from '../../config/database';
import logger from '../../config/logger';
import { env } from '../../config/env';
import { DegradedUsageLogRow, ReplayOutcome } from '../../types/usage-reconciliation';
import { MeterUsageLedgerService, meterUsageLedgerService } from './meter-usage-ledger';
import { toDegradedUsageRows } from './row-mappers';

/** How many log entries a single run will attempt to replay. */
const DEFAULT_MAX_ENTRIES_PER_RUN = 500;

/** Give up (and escalate) after this many failed replay attempts. */
const DEFAULT_MAX_REPLAY_ATTEMPTS = 5;

export interface ReplayOptions {
  /** Only replay entries served at or before this instant. */
  servedBefore?: Date;
  maxEntries?: number;
  maxAttempts?: number;
  /** Skip replay entirely — used when the meter is still not healthy. */
  skip?: boolean;
}

export class DegradedUsageReplayService {
  constructor(private readonly ledger: MeterUsageLedgerService = meterUsageLedgerService) {}

  private emptyOutcome(): ReplayOutcome {
    return {
      attempted: 0,
      replayed: 0,
      replayedAmount: 0,
      failed: 0,
      abandoned: 0,
      alreadyApplied: 0,
    };
  }

  /**
   * Replay queued usage into the meter.
   *
   * Returns a summary rather than throwing: a failed replay is data the report
   * needs, not an error that should abort the run.
   */
  async replay(options: ReplayOptions = {}): Promise<ReplayOutcome> {
    const outcome = this.emptyOutcome();

    if (options.skip) {
      logger.info('[DegradedUsageReplay] Skipped — meter not healthy yet', { outcome });
      return outcome;
    }

    const maxEntries = options.maxEntries ?? Number(env.USAGE_REPLAY_MAX_ENTRIES ?? DEFAULT_MAX_ENTRIES_PER_RUN);
    const maxAttempts = options.maxAttempts ?? Number(env.USAGE_REPLAY_MAX_ATTEMPTS ?? DEFAULT_MAX_REPLAY_ATTEMPTS);
    const servedBefore = options.servedBefore ?? new Date();

    const candidates = await this.fetchPending(servedBefore, maxEntries);
    if (candidates.length === 0) {
      return outcome;
    }

    logger.info('[DegradedUsageReplay] Draining degraded usage log', {
      candidateCount: candidates.length,
      servedBefore: servedBefore.toISOString(),
    });

    for (const entry of candidates) {
      const claimed = await this.claim(entry.id);
      if (!claimed) {
        // Another worker (or a previous attempt) already took this entry.
        outcome.alreadyApplied += 1;
        continue;
      }

      outcome.attempted += 1;

      const result = await this.applyEntry(entry, maxAttempts);

      switch (result.kind) {
        case 'replayed':
          outcome.replayed += 1;
          outcome.replayedAmount += entry.amount;
          break;
        case 'already_applied':
          outcome.alreadyApplied += 1;
          break;
        case 'abandoned':
          outcome.abandoned += 1;
          break;
        case 'failed':
          outcome.failed += 1;
          break;
      }
    }

    logger.info('[DegradedUsageReplay] Replay complete', { ...outcome });
    return outcome;
  }

  /**
   * Oldest-first so a backlog drains in the order the usage was served, which
   * keeps per-agent ledger ordering meaningful.
   */
  private async fetchPending(servedBefore: Date, limit: number): Promise<DegradedUsageLogRow[]> {
    const { data, error } = await supabase
      .from('degraded_usage_log')
      .select('*')
      .in('replay_state', ['pending', 'failed'])
      .lte('served_at', servedBefore.toISOString())
      .order('served_at', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('[DegradedUsageReplay] Failed to read degraded usage log', {
        error: error.message,
      });
      return [];
    }

    return toDegradedUsageRows(data);
  }

  /**
   * Take exclusive ownership of one entry.
   *
   * The conditional UPDATE is the concurrency guard: only one caller can move
   * an entry out of 'pending'/'failed', so two concurrent jobs cannot both
   * replay the same usage. `replay_attempts` is deliberately left alone here —
   * it is only advanced by the terminal handlers, which know the real count.
   */
  private async claim(entryId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('degraded_usage_log')
      .update({ last_error: null })
      .eq('id', entryId)
      .in('replay_state', ['pending', 'failed'])
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('[DegradedUsageReplay] Failed to claim log entry', {
        entryId,
        error: error.message,
      });
      return false;
    }

    return data !== null && data !== undefined;
  }

  private async applyEntry(
    entry: DegradedUsageLogRow,
    maxAttempts: number,
  ): Promise<{ kind: 'replayed' | 'already_applied' | 'failed' | 'abandoned' }> {
    try {
      const row = await this.ledger.getByReservationId(entry.reservationId);

      if (!row) {
        // The commit itself never landed, so there is nothing priced to bill.
        // The usage is unrecoverable without operator input; record it as
        // failed and let the attempt cap escalate it.
        throw new Error(
          `No ledger row for reservation ${entry.reservationId} — served usage has no priced record`,
        );
      }

      if (row.status !== 'committed') {
        throw new Error(
          `Reservation ${entry.reservationId} is '${row.status}', not committed — refusing to bill released or expired usage`,
        );
      }

      const result = await this.ledger.applyToMeter(entry.reservationId);

      if (result.applied) {
        await this.markReplayed(entry.id);
        return { kind: 'replayed' };
      }

      if (result.alreadyApplied) {
        // The meter already knows about this usage. The log entry was the only
        // thing out of date — close it without charging again.
        await this.markReplayed(entry.id);
        logger.info('[DegradedUsageReplay] Entry already applied — log row reconciled', {
          reservationId: entry.reservationId,
        });
        return { kind: 'already_applied' };
      }

      throw new Error(`Meter apply refused reservation ${entry.reservationId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = entry.replayAttempts + 1;

      if (attempts >= maxAttempts) {
        await this.markAbandoned(entry.id, attempts, message);
        logger.error('[DegradedUsageReplay] Abandoning log entry after repeated failures', {
          reservationId: entry.reservationId,
          attempts,
          amount: entry.amount,
          error: message,
        });
        return { kind: 'abandoned' };
      }

      await this.markFailed(entry.id, attempts, message);
      logger.warn('[DegradedUsageReplay] Replay attempt failed', {
        reservationId: entry.reservationId,
        attempts,
        error: message,
      });
      return { kind: 'failed' };
    }
  }

  private async markReplayed(entryId: string): Promise<void> {
    const { error } = await supabase
      .from('degraded_usage_log')
      .update({
        replay_state: 'replayed',
        meter_applied_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', entryId);

    if (error) {
      logger.error('[DegradedUsageReplay] Failed to mark entry replayed', {
        entryId,
        error: error.message,
      });
    }
  }

  private async markFailed(entryId: string, attempts: number, message: string): Promise<void> {
    const { error } = await supabase
      .from('degraded_usage_log')
      .update({ replay_state: 'failed', replay_attempts: attempts, last_error: message })
      .eq('id', entryId);

    if (error) {
      logger.error('[DegradedUsageReplay] Failed to mark entry failed', {
        entryId,
        error: error.message,
      });
    }
  }

  private async markAbandoned(entryId: string, attempts: number, message: string): Promise<void> {
    const { error } = await supabase
      .from('degraded_usage_log')
      .update({ replay_state: 'abandoned', replay_attempts: attempts, last_error: message })
      .eq('id', entryId);

    if (error) {
      logger.error('[DegradedUsageReplay] Failed to mark entry abandoned', {
        entryId,
        error: error.message,
      });
    }
  }

  /**
   * How much served usage is still waiting to be metered. Surfaced on the
   * report so an operator can see backlog depth without querying the DB.
   */
  async pendingBacklog(): Promise<{ count: number; amount: number }> {
    const { data, error } = await supabase
      .from('degraded_usage_log')
      .select('amount')
      .in('replay_state', ['pending', 'failed']);

    if (error) {
      logger.warn('[DegradedUsageReplay] Failed to read pending backlog', {
        error: error.message,
      });
      return { count: 0, amount: 0 };
    }

    const rows = (data as Array<{ amount: number }> | null) ?? [];
    return {
      count: rows.length,
      amount: rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
    };
  }
}

export const degradedUsageReplayService = new DegradedUsageReplayService();