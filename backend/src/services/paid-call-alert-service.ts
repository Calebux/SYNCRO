import logger from '../config/logger';
import { slackService } from './slack-service';
import { env } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────

export interface PaidCallAlertPayload {
  alertType:
    | 'high_unsettled_value'
    | 'rising_unsettled_value'
    | 'reconciliation_delta_outside_tolerance'
    | 'reconciliation_blocked'
    | 'meter_reserve_failure_spike'
    | 'meter_commit_failure_spike'
    | 'settlement_submission_failure'
    | 'indexer_lag';
  severity: 'critical' | 'warning' | 'info';
  channelId?: string;
  userId?: string;
  unsettledValue?: number;
  channelSize?: number;
  totalUnsettledValue?: number;
  totalDelta?: number;
  channelsOutOfTolerance?: number;
  blocked?: boolean;
  reserveFailures?: number;
  commitFailures?: number;
  successRatePct?: number;
  indexerLagBlocks?: number;
  indexerLagMs?: number;
  runId?: string;
  deltasByCause?: Record<string, number>;
}

// ─── Thresholds ───────────────────────────────────────────────────

const UNSETTLED_VALUE_HIGH_THRESHOLD = 0.5; // 50% of channel size
const UNSETTLED_VALUE_RISING_THRESHOLD_PCT = 20; // 20% increase in 1 hour
const METER_RESERVE_FAILURE_SPIKE = 10; // failures in 5 minutes
const METER_COMMIT_FAILURE_SPIKE = 10; // failures in 5 minutes
const SETTLEMENT_SUBMISSION_FAILURE_RATE = 95; // percent
const INDEXER_LAG_BLOCKS = 10; // blocks (~50 seconds)

// ─── Service ──────────────────────────────────────────────────────

class PaidCallAlertService {
  private lastUnsettledValue: number = 0;
  private lastAlertTime: Record<string, number> = {};
  private readonly alertCooldownMs = 5 * 60 * 1000; // 5 minutes between duplicate alerts

  /**
   * Check unsettled value per channel and alert if any channel exceeds the threshold.
   */
  async checkUnsettledValue(
    channels: Array<{
      channelId: string;
      userId: string;
      unsettledValue: number;
      channelSize?: number;
    }>,
  ): Promise<void> {
    for (const channel of channels) {
      const size = channel.channelSize ?? 0;
      if (size <= 0) continue;

      const ratio = channel.unsettledValue / size;

      // Critical: unsettled value exceeds 50% of channel size
      if (ratio >= UNSETTLED_VALUE_HIGH_THRESHOLD) {
        await this.sendAlert({
          alertType: 'high_unsettled_value',
          severity: 'critical',
          channelId: channel.channelId,
          userId: channel.userId,
          unsettledValue: channel.unsettledValue,
          channelSize: size,
        });
      }
    }

    // Check total unsettled value trend
    const totalUnsettled = channels.reduce((sum, c) => sum + c.unsettledValue, 0);
    if (this.lastUnsettledValue > 0 && totalUnsettled > 0) {
      const increasePct = ((totalUnsettled - this.lastUnsettledValue) / this.lastUnsettledValue) * 100;
      if (increasePct >= UNSETTLED_VALUE_RISING_THRESHOLD_PCT) {
        await this.sendAlert({
          alertType: 'rising_unsettled_value',
          severity: 'warning',
          totalUnsettledValue: totalUnsettled,
        });
      }
    }
    this.lastUnsettledValue = totalUnsettled;
  }

  /**
   * Check reconciliation delta and alert if outside tolerance.
   */
  async checkReconciliationDelta(params: {
    totalDelta: number;
    channelsOutOfTolerance: number;
    blocked: boolean;
    runId?: string;
    deltasByCause?: Record<string, number>;
  }): Promise<void> {
    if (params.channelsOutOfTolerance > 0) {
      await this.sendAlert({
        alertType: 'reconciliation_delta_outside_tolerance',
        severity: 'critical',
        totalDelta: params.totalDelta,
        channelsOutOfTolerance: params.channelsOutOfTolerance,
        runId: params.runId,
        deltasByCause: params.deltasByCause,
      });
    }

    if (params.blocked) {
      await this.sendAlert({
        alertType: 'reconciliation_blocked',
        severity: 'critical',
        blocked: true,
        runId: params.runId,
      });
    }
  }

  /**
   * Check meter reserve failure rate and alert if spike detected.
   */
  async checkMeterReserveFailures(failureCount: number): Promise<void> {
    if (failureCount >= METER_RESERVE_FAILURE_SPIKE) {
      await this.sendAlert({
        alertType: 'meter_reserve_failure_spike',
        severity: 'warning',
        reserveFailures: failureCount,
      });
    }
  }

  /**
   * Check meter commit failure rate and alert if spike detected.
   */
  async checkMeterCommitFailures(failureCount: number): Promise<void> {
    if (failureCount >= METER_COMMIT_FAILURE_SPIKE) {
      await this.sendAlert({
        alertType: 'meter_commit_failure_spike',
        severity: 'warning',
        commitFailures: failureCount,
      });
    }
  }

  /**
   * Check settlement submission success rate and alert if below threshold.
   */
  async checkSettlementSubmission(successRatePct: number): Promise<void> {
    if (successRatePct < SETTLEMENT_SUBMISSION_FAILURE_RATE) {
      await this.sendAlert({
        alertType: 'settlement_submission_failure',
        severity: 'warning',
        successRatePct,
      });
    }
  }

  /**
   * Check indexer lag and alert if behind.
   */
  async checkIndexerLag(lagBlocks: number, lagMs: number): Promise<void> {
    if (lagBlocks > INDEXER_LAG_BLOCKS) {
      await this.sendAlert({
        alertType: 'indexer_lag',
        severity: 'warning',
        indexerLagBlocks: lagBlocks,
        indexerLagMs: lagMs,
      });
    }
  }

  private async sendAlert(payload: PaidCallAlertPayload): Promise<void> {
    const now = Date.now();
    const cooldownKey = `${payload.alertType}_${payload.channelId ?? 'global'}`;
    const lastSent = this.lastAlertTime[cooldownKey] ?? 0;

    if (now - lastSent < this.alertCooldownMs) {
      logger.debug('[PaidCallAlert] Suppressing duplicate alert (cooldown)', {
        alertType: payload.alertType,
        cooldownKey,
      });
      return;
    }

    this.lastAlertTime[cooldownKey] = now;

    const message = this.formatAlertMessage(payload);

    try {
      await slackService.sendCustomMessage(message, { maxAttempts: 1 });
      logger.info('[PaidCallAlert] Alert sent', { alertType: payload.alertType, severity: payload.severity });
    } catch (err) {
      logger.error('[PaidCallAlert] Failed to send alert', {
        alertType: payload.alertType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private formatAlertMessage(payload: PaidCallAlertPayload): string {
    const severityEmoji = payload.severity === 'critical' ? '🔴' : payload.severity === 'warning' ? '🟠' : '🟡';
    const base = `${severityEmoji} *SYNCRO Paid-Call Alert: ${payload.alertType}*\n`;

    switch (payload.alertType) {
      case 'high_unsettled_value':
        return `${base}Channel \`${payload.channelId}\` (user: \`${payload.userId}\`) has unsettled value of *${payload.unsettledValue}* against channel size *${payload.channelSize}* (${((payload.unsettledValue ?? 0) / (payload.channelSize ?? 1) * 100).toFixed(1)}% of channel).`;

      case 'rising_unsettled_value':
        return `${base}Total unsettled value across all channels has risen to *${payload.totalUnsettledValue}* — a significant increase detected.`;

      case 'reconciliation_delta_outside_tolerance':
        return `${base}Reconciliation delta outside tolerance: *${payload.totalDelta}* total delta across *${payload.channelsOutOfTolerance}* channels.\nRun ID: \`${payload.runId ?? 'unknown'}\`\nCauses: ${JSON.stringify(payload.deltasByCause)}`;

      case 'reconciliation_blocked':
        return `${base}Settlement batch is *BLOCKED* due to reconciliation delta outside tolerance.\nRun ID: \`${payload.runId ?? 'unknown'}\`\nManual investigation required before settlement can resume.`;

      case 'meter_reserve_failure_spike':
        return `${base}Meter reserve failures spiked: *${payload.reserveFailures}* failures in the last 5 minutes.`;

      case 'meter_commit_failure_spike':
        return `${base}Meter commit failures spiked: *${payload.commitFailures}* failures in the last 5 minutes.`;

      case 'settlement_submission_failure':
        return `${base}Settlement submission success rate dropped to *${payload.successRatePct}%* — below the 95% threshold.`;

      case 'indexer_lag':
        return `${base}Indexer lag detected: *${payload.indexerLagBlocks}* blocks behind (~${payload.indexerLagMs ?? 0}ms).\nThe indexer is falling behind on-chain state.`;

      default:
        return `${base}Paid-call metric alert: ${JSON.stringify(payload)}`;
    }
  }
}

export const paidCallAlertService = new PaidCallAlertService();
