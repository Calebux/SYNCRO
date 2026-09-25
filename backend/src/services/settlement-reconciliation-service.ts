import { randomUUID } from 'crypto';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { env } from '../config/env';
import { v3NotificationDispatch } from './v3-notification-dispatch';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeltaCause =
  | 'unsettled_window'       // normal: gap between last chain settlement and now
  | 'degraded_mode_usage'    // usage recorded while admission was in degraded mode
  | 'orphaned_reservation'   // meter_reserves that never committed or expired
  | 'failed_submission'      // pending_settlement stuck in non-submitted state
  | 'state_mismatch'         // engine signed-state total disagrees with meter sum
  | 'chain_lag'              // submission exists but no contract_event yet
  | 'unknown';

export interface PairwiseDelta {
  /** Human label for the pair being compared */
  pair: 'meter_vs_engine' | 'engine_vs_chain' | 'meter_vs_chain';
  meterValue: number;
  engineValue: number;
  chainValue: number;
  /** Absolute delta for this pair */
  delta: number;
  /** Delta as % of the larger value (0 when both sides are 0) */
  deltaPercent: number;
  withinTolerance: boolean;
  cause: DeltaCause;
}

export interface ChannelReconciliation {
  channelId: string;
  userId: string;
  /** Sum of off-chain payments recorded in channel_payments since last chain settlement */
  meterSum: number;
  /** Engine's accumulated executor balance in the newest signed state */
  engineExecutorBalance: number;
  /** On-chain settled amount for this channel (from contract_events / pending_settlements) */
  chainSettledAmount: number;
  /** Sequence number of the newest signed state */
  engineSequenceNumber: number;
  pairwiseDeltas: PairwiseDelta[];
  allWithinTolerance: boolean;
}

export interface ReconciliationRun {
  runId: string;
  startedAt: string;
  completedAt: string;
  tolerancePct: number;
  channels: ChannelReconciliation[];
  totalChannels: number;
  channelsOutOfTolerance: number;
  /** Absolute sum of all deltas across all channels, by cause */
  deltasByCause: Record<DeltaCause, number>;
  blocked: boolean;
  /** True if the run itself failed to complete */
  runError?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyDelta(
  meterValue: number,
  engineValue: number,
  chainValue: number,
  pair: PairwiseDelta['pair'],
  orphanedReservations: number,
  hasFailedSubmissions: boolean,
  channelInDegradedMode: boolean,
): DeltaCause {
  const delta = Math.abs(
    pair === 'meter_vs_engine' ? meterValue - engineValue
    : pair === 'engine_vs_chain' ? engineValue - chainValue
    : meterValue - chainValue,
  );

  if (delta === 0) return 'unsettled_window';

  if (pair === 'meter_vs_engine' && orphanedReservations > 0 && delta <= orphanedReservations) {
    return 'orphaned_reservation';
  }
  if (channelInDegradedMode) return 'degraded_mode_usage';
  if (pair === 'engine_vs_chain' && hasFailedSubmissions) return 'failed_submission';
  if (pair === 'engine_vs_chain' && engineValue > chainValue) return 'chain_lag';
  if (pair === 'meter_vs_engine') return 'state_mismatch';

  return 'unsettled_window';
}

function pairwiseDelta(
  pair: PairwiseDelta['pair'],
  meterValue: number,
  engineValue: number,
  chainValue: number,
  tolerancePct: number,
  orphanedReservations: number,
  hasFailedSubmissions: boolean,
  channelInDegradedMode: boolean,
): PairwiseDelta {
  const lhs =
    pair === 'meter_vs_engine' ? meterValue
    : pair === 'engine_vs_chain' ? engineValue
    : meterValue;
  const rhs =
    pair === 'meter_vs_engine' ? engineValue
    : pair === 'engine_vs_chain' ? chainValue
    : chainValue;

  const delta = Math.abs(lhs - rhs);
  const base = Math.max(lhs, rhs);
  const deltaPercent = base > 0 ? (delta / base) * 100 : 0;
  const withinTolerance = deltaPercent <= tolerancePct;

  return {
    pair,
    meterValue,
    engineValue,
    chainValue,
    delta,
    deltaPercent,
    withinTolerance,
    cause: classifyDelta(
      meterValue, engineValue, chainValue, pair,
      orphanedReservations, hasFailedSubmissions, channelInDegradedMode,
    ),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class SettlementReconciliationService {
  private blocked = false;

  isBlocked(): boolean {
    return this.blocked;
  }

  unblock(): void {
    this.blocked = false;
    logger.info('[SettlementReconciliation] Settlement batch unblocked');
  }

  async run(): Promise<ReconciliationRun> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const tolerancePct = Number(env.RECONCILIATION_TOLERANCE_PCT ?? 1);

    logger.info('[SettlementReconciliation] Starting three-way reconciliation', { runId, tolerancePct });

    try {
      const result = await this._runInner(runId, startedAt, tolerancePct);
      await this._persist(result);
      return result;
    } catch (err) {
      const runError = err instanceof Error ? err.message : String(err);
      logger.error('[SettlementReconciliation] Run failed', { runId, error: runError });
      const failed: ReconciliationRun = {
        runId, startedAt, completedAt: new Date().toISOString(),
        tolerancePct, channels: [], totalChannels: 0,
        channelsOutOfTolerance: 0, deltasByCause: {} as Record<DeltaCause, number>,
        blocked: false, runError,
      };
      await this._persist(failed);
      return failed;
    }
  }

  private async _runInner(
    runId: string,
    startedAt: string,
    tolerancePct: number,
  ): Promise<ReconciliationRun> {
    // 1. Fetch all active channels (source of truth for the engine view)
    const { data: channelRows, error: chErr } = await supabase
      .from('payment_channels')
      .select('id, user_id, channel_state, last_settlement_at, state')
      .in('state', ['active', 'closing', 'closed']);

    if (chErr) throw new Error(`Failed to fetch channels: ${chErr.message}`);

    // 2. Orphaned reservations per user (meter_reserves expired but not committed)
    const { data: orphanRows } = await supabase
      .from('meter_reserves')
      .select('user_id, amount')
      .lt('expires_at', new Date().toISOString());

    const orphansByUser = new Map<string, number>();
    for (const r of orphanRows ?? []) {
      orphansByUser.set(r.user_id, (orphansByUser.get(r.user_id) ?? 0) + Number(r.amount));
    }

    // 3. Failed pending_settlements per channel
    const { data: failedSettlements } = await supabase
      .from('pending_settlements')
      .select('payload, status')
      .eq('status', 'pending')
      .lt('created_at', new Date(Date.now() - Number(env.SETTLEMENT_MAX_WAIT_MS ?? 300000) * 2).toISOString());

    const failedChannelIds = new Set<string>();
    for (const s of failedSettlements ?? []) {
      const channelId = (s.payload as Record<string, unknown>)?.channelId as string | undefined;
      if (channelId) failedChannelIds.add(channelId);
    }

    // 4. Per-channel: meter sum from channel_payments since last settlement
    // Per-channel: chain settled amount from contract_events
    const channelIds = (channelRows ?? []).map((r: { id: unknown }) => r.id as string);

    const [paymentSumsByChannel, contractAmountsByChannel] = await Promise.all([
      this._fetchMeterSumsByChannel(channelIds),
      this._fetchChainAmountsByChannel(channelIds),
    ]);

    // 5. Compute per-channel reconciliation
    const channels: ChannelReconciliation[] = [];
    const deltasByCause: Record<DeltaCause, number> = {
      unsettled_window: 0,
      degraded_mode_usage: 0,
      orphaned_reservation: 0,
      failed_submission: 0,
      state_mismatch: 0,
      chain_lag: 0,
      unknown: 0,
    };

    for (const row of channelRows ?? []) {
      const channelId = row.id as string;
      const userId = row.user_id as string;
      const state = row.channel_state as {
        executorBalance?: number;
        sequenceNumber?: number;
      } | null;

      const engineExecutorBalance = state?.executorBalance ?? 0;
      const engineSequenceNumber = state?.sequenceNumber ?? 0;
      const meterSum = paymentSumsByChannel.get(channelId) ?? 0;
      const chainSettledAmount = contractAmountsByChannel.get(channelId) ?? 0;
      const orphanedReservations = orphansByUser.get(userId) ?? 0;
      const hasFailedSubmissions = failedChannelIds.has(channelId);
      // Heuristic: if channel entered closing/dispute state unexpectedly we flag degraded mode
      const channelInDegradedMode = row.state === 'closing' && engineExecutorBalance > 0 && chainSettledAmount === 0;

      const pairs: PairwiseDelta[] = [
        pairwiseDelta('meter_vs_engine', meterSum, engineExecutorBalance, chainSettledAmount,
          tolerancePct, orphanedReservations, hasFailedSubmissions, channelInDegradedMode),
        pairwiseDelta('engine_vs_chain', meterSum, engineExecutorBalance, chainSettledAmount,
          tolerancePct, orphanedReservations, hasFailedSubmissions, channelInDegradedMode),
        pairwiseDelta('meter_vs_chain', meterSum, engineExecutorBalance, chainSettledAmount,
          tolerancePct, orphanedReservations, hasFailedSubmissions, channelInDegradedMode),
      ];

      for (const p of pairs) {
        if (!p.withinTolerance) {
          deltasByCause[p.cause] = (deltasByCause[p.cause] ?? 0) + p.delta;
        }
      }

      channels.push({
        channelId, userId,
        meterSum, engineExecutorBalance, chainSettledAmount, engineSequenceNumber,
        pairwiseDeltas: pairs,
        allWithinTolerance: pairs.every((p) => p.withinTolerance),
      });
    }

    const channelsOutOfTolerance = channels.filter((c) => !c.allWithinTolerance).length;
    const shouldBlock = channelsOutOfTolerance > 0;

    if (shouldBlock && !this.blocked) {
      this.blocked = true;
      logger.warn('[SettlementReconciliation] Settlement batch BLOCKED — delta outside tolerance', {
        runId,
        channelsOutOfTolerance,
        deltasByCause,
      });
    } else if (!shouldBlock && this.blocked) {
      this.blocked = false;
      logger.info('[SettlementReconciliation] Settlement batch UNBLOCKED — all channels within tolerance', { runId });
    }

    const completedAt = new Date().toISOString();
    const result: ReconciliationRun = {
      runId, startedAt, completedAt, tolerancePct,
      channels, totalChannels: channels.length, channelsOutOfTolerance,
      deltasByCause, blocked: this.blocked,
    };

    // 6. Notify operators if any channel is out of tolerance
    if (channelsOutOfTolerance > 0) {
      await this._dispatchAlert(result);
    }

    logger.info('[SettlementReconciliation] Run complete', {
      runId,
      totalChannels: channels.length,
      channelsOutOfTolerance,
      blocked: this.blocked,
      deltasByCause,
    });

    return result;
  }

  private async _fetchMeterSumsByChannel(channelIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (channelIds.length === 0) return out;

    const { data, error } = await supabase
      .from('channel_payments')
      .select('channel_id, amount')
      .in('channel_id', channelIds);

    if (error) {
      logger.warn('[SettlementReconciliation] Failed to fetch channel_payments', { error: error.message });
      return out;
    }

    for (const row of data ?? []) {
      out.set(row.channel_id, (out.get(row.channel_id) ?? 0) + Number(row.amount));
    }
    return out;
  }

  private async _fetchChainAmountsByChannel(channelIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (channelIds.length === 0) return out;

    // Submitted settlements give us the chain view; we use submitted_at as proxy
    // for confirmed-on-chain until a contract_events indexer enriches the record.
    const { data, error } = await supabase
      .from('pending_settlements')
      .select('payload, amount, status')
      .in('status', ['submitted'])
      .not('payload', 'is', null);

    if (error) {
      logger.warn('[SettlementReconciliation] Failed to fetch pending_settlements for chain view', { error: error.message });
      return out;
    }

    for (const row of data ?? []) {
      const channelId = (row.payload as Record<string, unknown>)?.channelId as string | undefined;
      if (channelId && channelIds.includes(channelId)) {
        out.set(channelId, (out.get(channelId) ?? 0) + Number(row.amount));
      }
    }
    return out;
  }

  private async _dispatchAlert(run: ReconciliationRun): Promise<void> {
    const outOfTolerance = run.channels.filter((c) => !c.allWithinTolerance);
    const causeBreakdown: Record<string, number> = {};
    for (const [cause, total] of Object.entries(run.deltasByCause)) {
      if (total > 0) causeBreakdown[cause] = total;
    }

    v3NotificationDispatch.dispatch({
      eventType: 'reconciliation_delta_outside_tolerance',
      payload: {
        runId: run.runId,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        totalMismatches: run.channelsOutOfTolerance,
        mismatchesByType: {
          missing_from_history: run.deltasByCause['state_mismatch'] > 0 ? outOfTolerance.length : 0,
          orphan_event: run.deltasByCause['orphaned_reservation'] > 0
            ? outOfTolerance.filter((c) =>
                c.pairwiseDeltas.some((p) => p.cause === 'orphaned_reservation')
              ).length
            : 0,
          hash_mismatch: run.deltasByCause['chain_lag'] > 0
            ? outOfTolerance.filter((c) =>
                c.pairwiseDeltas.some((p) => p.cause === 'chain_lag')
              ).length
            : 0,
        },
        totalContractEvents: run.totalChannels,
        totalRenewalRecords: run.channels.length,
        matched: run.totalChannels - run.channelsOutOfTolerance,
        tolerance: run.tolerancePct,
      },
    }).catch((err) => {
      logger.error('[SettlementReconciliation] Alert dispatch failed', {
        runId: run.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async _persist(run: ReconciliationRun): Promise<void> {
    const { error } = await supabase.from('settlement_reconciliation_runs').insert({
      run_id: run.runId,
      started_at: run.startedAt,
      completed_at: run.completedAt,
      tolerance_pct: run.tolerancePct,
      total_channels: run.totalChannels,
      channels_out_of_tolerance: run.channelsOutOfTolerance,
      deltas_by_cause: run.deltasByCause,
      blocked: run.blocked,
      run_error: run.runError ?? null,
      channel_details: run.channels,
    });

    if (error) {
      logger.warn('[SettlementReconciliation] Failed to persist run', {
        runId: run.runId,
        error: error.message,
      });
    }
  }
}

export const settlementReconciliationService = new SettlementReconciliationService();
