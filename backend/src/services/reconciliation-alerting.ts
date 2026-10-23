/**
 * backend/src/services/reconciliation-alerting.ts
 *
 * Place at: backend/src/services/reconciliation-alerting.ts (new file)
 *
 * Fires alerts on discrepancy counts and reconciliation lag, per the
 * acceptance criteria. Sends to whatever alert channel you already use —
 * this repo has Sentry wired in (see PR #239), so this defaults to that,
 * plus an optional Slack webhook. Swap `sendAlert` for your real channel.
 */

import * as Sentry from '@sentry/node'; // already a dependency per PR #239
import { ReconciliationAlertThresholds, ReconciliationRunResult } from '../types/reconciliation';
import { supabase } from '../lib/supabase'; // ADJUST: your Supabase client export

const THRESHOLDS: ReconciliationAlertThresholds = {
  maxOpenDiscrepancies: Number(process.env.RECON_ALERT_MAX_OPEN ?? 5),
  alertOnAnyCritical: true,
  maxReconciliationLagMs: Number(process.env.RECON_ALERT_MAX_LAG_MS ?? 15 * 60_000), // 15 min
};

export async function evaluateAndFireAlerts(
  result: ReconciliationRunResult | null,
  runError?: Error,
): Promise<void> {
  if (runError) {
    await sendAlert('critical', 'Reconciliation job failed to run', {
      error: runError.message,
      stack: runError.stack,
    });
    return;
  }

  if (!result) return;

  const openDiscrepancyCount = await countOpenDiscrepancies();
  const hasCritical = result.discrepanciesFound.some((d) => d.severity === 'critical');

  if (openDiscrepancyCount > THRESHOLDS.maxOpenDiscrepancies) {
    await sendAlert('high', 'Open reconciliation discrepancy count exceeds threshold', {
      openDiscrepancyCount,
      threshold: THRESHOLDS.maxOpenDiscrepancies,
      runId: result.runId,
    });
  }

  if (THRESHOLDS.alertOnAnyCritical && hasCritical) {
    await sendAlert('critical', 'Critical reconciliation discrepancy detected', {
      runId: result.runId,
      criticalDiscrepancies: result.discrepanciesFound.filter((d) => d.severity === 'critical'),
    });
  }

  if (result.reconciliationLagMs > THRESHOLDS.maxReconciliationLagMs) {
    await sendAlert('high', 'Reconciliation lag exceeds threshold', {
      lagMs: result.reconciliationLagMs,
      thresholdMs: THRESHOLDS.maxReconciliationLagMs,
      runId: result.runId,
    });
  }
}

async function countOpenDiscrepancies(): Promise<number> {
  const { count, error } = await supabase
    .from('reconciliation_discrepancies')
    .select('id', { count: 'exact', head: true })
    .in('resolution_status', ['pending', 'unresolved']);

  if (error) {
    console.error(`[reconciliation] failed to count open discrepancies: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

async function sendAlert(
  severity: 'low' | 'medium' | 'high' | 'critical',
  message: string,
  context: Record<string, unknown>,
): Promise<void> {
  console.error(`[reconciliation:${severity}] ${message}`, context);

  Sentry.captureMessage(`[Reconciliation] ${message}`, {
    level: severity === 'critical' ? 'fatal' : severity === 'high' ? 'error' : 'warning',
    extra: context,
  });

  const slackWebhook = process.env.RECON_ALERT_SLACK_WEBHOOK_URL;
  if (slackWebhook) {
    try {
      await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:rotating_light: *[${severity.toUpperCase()}] ${message}*\n\`\`\`${JSON.stringify(context, null, 2)}\`\`\``,
        }),
      });
    } catch (err) {
      console.error('[reconciliation] failed to post Slack alert', err);
    }
  }
}