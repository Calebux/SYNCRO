/**
 * backend/src/services/usage/settlement-handoff.ts
 *
 * Detects usage that was committed and metered but never settled, and hands it
 * to the settlement engine (issue #1445).
 *
 * Settling is batched, so "not settled yet" is normal most of the time. Only
 * rows that are metered, committed, still unsettled, and older than the
 * settlement grace period are acted on — those are usage where settlement
 * genuinely fell through the cracks rather than simply being queued.
 *
 * Hand-off goes through `SettlementBatcher.enqueue()` rather than inserting
 * directly, so the existing queue-depth limit, backpressure behaviour and
 * metrics keep applying. The engine already submits `pending_settlements` in
 * batches, so queued usage is settled by the normal path from there on.
 *
 * Deliberately *not* done: mutating channel balances from here. Channel balance
 * changes go through `applyOffChainRenewal`, which requires a signed payment
 * proof that a reconciliation back-fill has no legitimate way to produce.
 * Billing decisions like that belong to the settlement engine, not to a cron
 * job.
 */

import { supabase } from '../../config/database';
import logger from '../../config/logger';
import { env } from '../../config/env';
import {
  MeterUsageLedgerRow,
  SettlementHandoffOutcome,
} from '../../types/usage-reconciliation';
import {
  SettlementBackpressureError,
  SettlementBatcher,
  settlementBatcher,
} from '../settlement-batcher';
import { toLedgerRows } from './row-mappers';

/** Default grace period before metered-but-unsettled usage counts as an orphan. */
const DEFAULT_SETTLEMENT_GRACE_MS = 15 * 60 * 1000;

/** Default cap on how much usage one run hands to the settlement engine. */
const DEFAULT_MAX_HANDOFF_PER_RUN = 200;

/**
 * Stable reference for one usage record.
 *
 * Doubles as the idempotency key for the hand-off: it is the
 * `subscription_id` on the queued settlement row, so a row that is already
 * queued is detectable without a separate marker table.
 */
export function settlementReferenceFor(reservationId: string): string {
  return `usage:${reservationId}`;
}

export interface SettlementHandoffOptions {
  now?: Date;
  graceMs?: number;
  maxPerRun?: number;
  /** Skip the hand-off entirely — used when settlement is globally paused. */
  skip?: boolean;
}

export class SettlementHandoffService {
  constructor(private readonly batcher: SettlementBatcher = settlementBatcher) {}

  /**
   * Find unsettled-but-metered usage and hand it to the settlement engine.
   *
   * Never throws: a hand-off failure is data the reconciliation report needs,
   * not an error that should abort the run.
   */
  async handoffUnsettledUsage(
    options: SettlementHandoffOptions = {},
  ): Promise<SettlementHandoffOutcome> {
    const outcome: SettlementHandoffOutcome = {
      handedOff: 0,
      handedOffAmount: 0,
      backpressured: 0,
      failed: 0,
    };

    if (options.skip) {
      logger.info('[SettlementHandoff] Skipped — settlement is paused', { outcome });
      return outcome;
    }

    const now = options.now ?? new Date();
    const graceMs =
      options.graceMs ?? Number(env.USAGE_SETTLEMENT_GRACE_MS ?? DEFAULT_SETTLEMENT_GRACE_MS);
    const maxPerRun =
      options.maxPerRun ?? Number(env.USAGE_SETTLEMENT_MAX_HANDOFF ?? DEFAULT_MAX_HANDOFF_PER_RUN);
    const graceBoundary = new Date(now.getTime() - graceMs).toISOString();

    const candidates = await this.findUnsettled(graceBoundary, maxPerRun);
    if (candidates.length === 0) {
      return outcome;
    }

    logger.info('[SettlementHandoff] Handing unsettled usage to the settlement engine', {
      candidateCount: candidates.length,
      graceMs,
    });

    for (const row of candidates) {
      const amount = Number(row.actualAmount ?? 0);
      const reference = settlementReferenceFor(row.reservationId);

      // Already queued by an earlier run: record that it is settled and move on
      // without enqueueing the same usage twice.
      if (await this.isAlreadyQueued(reference)) {
        if (await this.markSettled(row.reservationId)) {
          outcome.handedOff += 1;
          outcome.handedOffAmount += amount;
        } else {
          outcome.failed += 1;
        }
        continue;
      }

      try {
        await this.batcher.enqueue({
          userId: row.agentId,
          subscriptionId: reference,
          amount,
          settlementType: 'renewal',
          payload: {
            reservationId: row.reservationId,
            agentId: row.agentId,
            source: 'usage_reconciliation',
            settlementKind: 'metered_usage',
          },
        });

        if (!(await this.markSettled(row.reservationId))) {
          // Queued but unstampable. The reference makes the next run's
          // isAlreadyQueued() catch it, so this converges rather than double
          // settling.
          outcome.failed += 1;
          logger.error('[SettlementHandoff] Queued usage but could not stamp as settled', {
            reservationId: row.reservationId,
            reference,
          });
          continue;
        }

        outcome.handedOff += 1;
        outcome.handedOffAmount += amount;
      } catch (err) {
        if (err instanceof SettlementBackpressureError) {
          // The queue is full. Leave the row unsettled so a later run retries
          // it — dropping it here would recreate exactly the gap we exist to
          // close.
          outcome.backpressured += 1;
          logger.warn('[SettlementHandoff] Settlement queue full — usage left for a later run', {
            reservationId: row.reservationId,
            amount,
          });
          continue;
        }

        outcome.failed += 1;
        logger.error('[SettlementHandoff] Failed to hand usage to the settlement engine', {
          reservationId: row.reservationId,
          amount,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('[SettlementHandoff] Hand-off complete', { ...outcome });
    return outcome;
  }

  /**
   * Committed, metered, and unsettled past the grace boundary.
   */
  private async findUnsettled(graceBoundary: string, limit: number): Promise<MeterUsageLedgerRow[]> {
    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .select('*')
      .eq('status', 'committed')
      .not('metered_at', 'is', null)
      .is('settled_at', null)
      .lte('committed_at', graceBoundary)
      .order('committed_at', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('[SettlementHandoff] Failed to read unsettled usage', { error: error.message });
      return [];
    }
    return toLedgerRows(data);
  }

  private async isAlreadyQueued(reference: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('pending_settlements')
      .select('id')
      .eq('subscription_id', reference)
      .in('status', ['pending', 'submitted'])
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.warn('[SettlementHandoff] Failed to check the settlement queue', {
        reference,
        error: error.message,
      });
      // Assume not queued. Worst case the engine sees a duplicate reference,
      // which the batcher already tolerates; the alternative — skipping a row
      // we could not verify — would leave usage unsettled indefinitely.
      return false;
    }
    return data !== null && data !== undefined;
  }

  /**
   * Stamp the usage as settled.
   *
   * Guarded on `settled_at is null` so concurrent runs cannot both claim it.
   */
  private async markSettled(reservationId: string): Promise<boolean> {
    const { error } = await supabase
      .from('meter_usage_ledger')
      .update({
        settled_at: new Date().toISOString(),
        settlement_ref: settlementReferenceFor(reservationId),
      })
      .eq('reservation_id', reservationId)
      .is('settled_at', null);

    if (error) {
      logger.error('[SettlementHandoff] Failed to stamp usage as settled', {
        reservationId,
        error: error.message,
      });
      return false;
    }
    return true;
  }
}

export const settlementHandoffService = new SettlementHandoffService();