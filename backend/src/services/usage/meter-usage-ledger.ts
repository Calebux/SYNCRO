/**
 * backend/src/services/usage/meter-usage-ledger.ts
 *
 * The durable write path for metered usage (issue #1445).
 *
 * Every metered call gets one row in `meter_usage_ledger` that carries the
 * whole reserve → commit → settle lifecycle. Writing the reservation durably
 * is what makes the reconciliation job able to answer "was this served? was it
 * metered? was it settled?" after the fact — without it, a process crash
 * between reserve and commit leaves no evidence that anything happened.
 *
 * The rule this module enforces: a served call is accounted for exactly once.
 *   - Reserve durably before the upstream is called.
 *   - On commit, apply the usage to the meter. If the meter cannot take the
 *     write, queue it in `degraded_usage_log` instead of dropping it. The daily
 *     reconciliation job replays that queue.
 *   - On release, record why, so a clean release is distinguishable from a
 *     crash when the reconciler classifies orphans.
 */

import { randomBytes } from 'crypto';
import { supabase } from '../../config/database';
import logger from '../../config/logger';
import { redisStoreInstance } from '../../lib/redis-store';
import { getRequestId } from '../../middleware/requestContext';
import {
  CommitOutcome,
  DegradedUsageReason,
  MeterUsageLedgerRow,
  ReleaseOutcome,
  ReserveOutcome,
} from '../../types/usage-reconciliation';
import { toLedgerRow } from './row-mappers';

/** Default reservation TTL: long enough to cover a slow upstream call. */
const DEFAULT_RESERVATION_TTL_MS = 60_000;

/**
 * The idempotency key for applying a served call to the meter.
 *
 * Derived from the reservation id, so it is stable across process restarts and
 * identical on every retry. `meter_usage_ledger.meter_idempotency_key` has a
 * unique index on it, which is the hard guarantee that replay cannot
 * double-charge an agent.
 */
export function meterIdempotencyKeyFor(reservationId: string): string {
  return `meter:${reservationId}`;
}

export function newReservationId(): string {
  return `res_${randomBytes(12).toString('hex')}`;
}

interface ReserveInput {
  agentId: string;
  route: string;
  unitName: string;
  reservedUnits: number;
  reservedAmount: number;
  ttlMs?: number;
  correlationId?: string | null;
}

interface CommitInput {
  reservationId: string;
  actualUnits: number | null;
  actualAmount: number;
  fallbackUsed: boolean;
  correlationId?: string | null;
}

/**
 * Reports whether the meter can currently be trusted with a write.
 *
 * Injected rather than imported directly so the metering path stays testable
 * without standing up the redis store, and so a future store can be swapped in
 * without touching the request path.
 */
export type MeterHealthProbe = () => boolean;

/**
 * Default probe: ask the redis store whether it is running degraded.
 *
 * Degraded mode means a critical dependency is down and the system is running
 * on a fallback. Usage served in that window is still real usage, but the
 * meter is not authoritative, so the write is queued for replay rather than
 * trusted.
 *
 * If the probe itself throws we report degraded: we are not entitled to
 * assume the meter is healthy when we cannot tell.
 */
const defaultMeterHealthProbe: MeterHealthProbe = () => {
  try {
    return redisStoreInstance.isDegraded() === true;
  } catch (err) {
    logger.warn('[MeterUsageLedger] Could not read degraded status — treating meter as unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
};

export class MeterUsageLedgerService {
  constructor(private readonly isMeterDegraded: MeterHealthProbe = defaultMeterHealthProbe) {}

  /**
   * Record a reservation before the upstream call is made.
   *
   * Returns `persisted: false` when the durable write failed. The caller must
   * fail closed in that case: serving usage we cannot account for is exactly
   * the gap this issue exists to close.
   */
  async reserve(input: ReserveInput): Promise<ReserveOutcome> {
    const reservationId = newReservationId();
    const now = Date.now();
    const ttlMs = input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;

    const { error } = await supabase.from('meter_usage_ledger').insert({
      reservation_id: reservationId,
      agent_id: input.agentId,
      route: input.route,
      unit_name: input.unitName,
      status: 'reserved',
      reserved_units: input.reservedUnits,
      reserved_amount: input.reservedAmount,
      expires_at: new Date(now + ttlMs).toISOString(),
      correlation_id: input.correlationId ?? getRequestId() ?? null,
    });

    if (error) {
      logger.error('[MeterUsageLedger] Failed to persist reservation', {
        reservationId,
        agentId: input.agentId,
        error: error.message,
      });
      return { reservationId, persisted: false };
    }

    return { reservationId, persisted: true };
  }

  /**
   * Commit served usage.
   *
   * On the healthy path this is a single conditional UPDATE: it commits the
   * row and applies it to the meter in one round trip, because this runs on the
   * request path and every extra statement is latency an agent pays for. The
   * `status = 'reserved'` predicate makes a double commit a no-op.
   *
   * When the meter is degraded or the write fails, the usage is queued in
   * `degraded_usage_log` for the reconciliation job to replay rather than being
   * dropped.
   */
  async commit(input: CommitInput): Promise<CommitOutcome> {
    const committedAt = new Date().toISOString();
    const degradedReason = this.classifyMeterAvailability();

    const meterFields = degradedReason
      ? {}
      : {
          metered_at: committedAt,
          meter_idempotency_key: meterIdempotencyKeyFor(input.reservationId),
        };

    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .update({
        status: 'committed',
        actual_units: input.actualUnits,
        actual_amount: input.actualAmount,
        fallback_used: input.fallbackUsed,
        committed_at: committedAt,
        ...meterFields,
      })
      .eq('reservation_id', input.reservationId)
      .eq('status', 'reserved')
      .select('id, metered_at')
      .maybeSingle();

    if (error) {
      logger.error('[MeterUsageLedger] Failed to commit reservation', {
        reservationId: input.reservationId,
        error: error.message,
      });
      return this.queueOrGiveUp(input, 'meter_write_failed');
    }

    if (!data) {
      // No row moved. Either the reservation was already committed (a retry),
      // or it was released/expired, in which case there is nothing to bill.
      // Queueing is still the safe move: the replay step re-checks the ledger
      // status and refuses to bill a released reservation.
      logger.warn('[MeterUsageLedger] Commit matched no reserved row', {
        reservationId: input.reservationId,
      });
      return this.queueOrGiveUp(input, degradedReason ?? 'meter_write_failed');
    }

    if (degradedReason) {
      return this.queueOrGiveUp(input, degradedReason);
    }

    return {
      reservationId: input.reservationId,
      metered: true,
      queuedForReplay: false,
      reason: null,
    };
  }

  /**
   * Queue usage for replay, reporting honestly if even that write failed.
   *
   * A false `queuedForReplay` means served usage has nowhere to go — the only
   * honest thing to do is say so loudly.
   */
  private async queueOrGiveUp(input: CommitInput, reason: DegradedUsageReason): Promise<CommitOutcome> {
    const queued = await this.enqueueDegraded({
      reservationId: input.reservationId,
      amount: input.actualAmount,
      units: input.actualUnits ?? 0,
      reason,
      correlationId: input.correlationId,
    });

    if (!queued) {
      logger.error('[MeterUsageLedger] Served usage could not be recorded anywhere', {
        reservationId: input.reservationId,
        agentAmount: input.actualAmount,
        reason,
      });
    }

    return {
      reservationId: input.reservationId,
      metered: false,
      queuedForReplay: queued,
      reason,
    };
  }

  /**
   * Record that a reservation will never be billed. The reason is mandatory:
   * it is the only thing that lets the reconciler tell a deliberate release
   * apart from a crash.
   */
  async release(reservationId: string, reason: string): Promise<ReleaseOutcome> {
    const { error } = await supabase
      .from('meter_usage_ledger')
      .update({
        status: 'released',
        release_reason: reason,
        released_at: new Date().toISOString(),
      })
      .eq('reservation_id', reservationId)
      .eq('status', 'reserved');

    if (error) {
      logger.error('[MeterUsageLedger] Failed to release reservation', {
        reservationId,
        error: error.message,
      });
      return { reservationId, released: false };
    }

    return { reservationId, released: true };
  }

  /**
   * Apply a committed reservation to the meter, exactly once.
   *
   * The `metered_at is null` guard makes this safe to call repeatedly: a second
   * call matches no rows and reports `alreadyApplied`. The unique index on
   * `meter_idempotency_key` is a second, independent guard against two
   * concurrent replays of the same reservation both succeeding.
   */
  async applyToMeter(reservationId: string): Promise<{ applied: boolean; alreadyApplied: boolean }> {
    const idempotencyKey = meterIdempotencyKeyFor(reservationId);

    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .update({
        metered_at: new Date().toISOString(),
        meter_idempotency_key: idempotencyKey,
      })
      .eq('reservation_id', reservationId)
      .is('metered_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('[MeterUsageLedger] Failed to apply usage to meter', {
        reservationId,
        error: error.message,
      });
      return { applied: false, alreadyApplied: false };
    }

    if (!data) {
      return { applied: false, alreadyApplied: true };
    }

    return { applied: true, alreadyApplied: false };
  }

  /**
   * Queue served usage for replay.
   *
   * Returns false only when the queue write itself failed — at that point the
   * usage has genuinely nowhere to go and the caller must surface it.
   */
  async enqueueDegraded(input: {
    reservationId: string;
    amount: number;
    units: number;
    reason: DegradedUsageReason;
    correlationId?: string | null;
    route?: string;
    unitName?: string;
    agentId?: string;
  }): Promise<boolean> {
    const { error } = await supabase.from('degraded_usage_log').insert({
      reservation_id: input.reservationId,
      agent_id: input.agentId ?? 'unknown',
      route: input.route ?? 'unknown',
      unit_name: input.unitName ?? 'calls',
      units: input.units,
      amount: input.amount,
      reason: input.reason,
      served_at: new Date().toISOString(),
      correlation_id: input.correlationId ?? getRequestId() ?? null,
      replay_state: 'pending',
    });

    if (error) {
      // A duplicate reservation_id means it is already queued — that is a
      // success, not a failure.
      if (error.code === '23505') {
        logger.info('[MeterUsageLedger] Degraded usage already queued', {
          reservationId: input.reservationId,
        });
        return true;
      }

      logger.error('[MeterUsageLedger] Failed to enqueue degraded usage — usage is unaccounted for', {
        reservationId: input.reservationId,
        amount: input.amount,
        error: error.message,
      });
      return false;
    }

    logger.warn('[MeterUsageLedger] Usage queued for replay', {
      reservationId: input.reservationId,
      amount: input.amount,
      reason: input.reason,
    });
    return true;
  }

  /**
   * Fetch a ledger row by its natural key. Returns null when absent.
   */
  async getByReservationId(reservationId: string): Promise<MeterUsageLedgerRow | null> {
    const { data, error } = await supabase
      .from('meter_usage_ledger')
      .select('*')
      .eq('reservation_id', reservationId)
      .maybeSingle();

    if (error) {
      logger.warn('[MeterUsageLedger] Failed to read ledger row', {
        reservationId,
        error: error.message,
      });
      return null;
    }
    return data ? toLedgerRow(data) : null;
  }

  /**
   * @returns the reason the meter cannot be trusted right now, or null if it
   *   is healthy.
   */
  private classifyMeterAvailability(): DegradedUsageReason | null {
    if (!this.isMeterDegraded()) return null;
    return 'degraded_mode';
  }
}

export const meterUsageLedgerService = new MeterUsageLedgerService();