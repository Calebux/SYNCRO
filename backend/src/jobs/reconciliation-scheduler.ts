/**
 * backend/src/jobs/reconciliation-scheduler.ts
 *
 * Place at: backend/src/jobs/reconciliation-scheduler.ts (new file)
 *
 * Runs the reconciliation invariant checks on a schedule:
 *   - a sliding-window check every 5 minutes (last 60 min of activity)
 *   - a full sweep once a day (checks every record, catches anything the
 *     sliding window missed due to downtime, clock skew, etc.)
 *
 * Wire this up in your app entrypoint (backend/src/index.ts):
 *
 *   import { startReconciliationScheduler } from './jobs/reconciliation-scheduler';
 *   startReconciliationScheduler();
 *
 * Requires `node-cron` (npm install node-cron @types/node-cron --save).
 */

import cron from 'node-cron';
import { runInvariantChecks } from '../services/reconciliation-invariants';
import { evaluateAndFireAlerts } from '../services/reconciliation-alerting';

const SLIDING_WINDOW_CRON = process.env.RECON_SLIDING_WINDOW_CRON ?? '*/5 * * * *'; // every 5 min
const FULL_SWEEP_CRON = process.env.RECON_FULL_SWEEP_CRON ?? '0 3 * * *'; // 03:00 daily
const SLIDING_WINDOW_MINUTES = Number(process.env.RECON_SLIDING_WINDOW_MINUTES ?? 60);

let slidingTask: cron.ScheduledTask | null = null;
let fullSweepTask: cron.ScheduledTask | null = null;

export function startReconciliationScheduler(): void {
  if (slidingTask || fullSweepTask) {
    console.warn('[reconciliation] scheduler already started — skipping duplicate start');
    return;
  }

  slidingTask = cron.schedule(SLIDING_WINDOW_CRON, async () => {
    await runReconciliationSafely('sliding_window', SLIDING_WINDOW_MINUTES);
  });

  fullSweepTask = cron.schedule(FULL_SWEEP_CRON, async () => {
    await runReconciliationSafely('full_sweep');
  });

  console.log(
    `[reconciliation] scheduler started — sliding window "${SLIDING_WINDOW_CRON}", full sweep "${FULL_SWEEP_CRON}"`,
  );
}

export function stopReconciliationScheduler(): void {
  slidingTask?.stop();
  fullSweepTask?.stop();
  slidingTask = null;
  fullSweepTask = null;
}

async function runReconciliationSafely(mode: 'sliding_window' | 'full_sweep', windowMinutes?: number) {
  try {
    const result = await runInvariantChecks(mode, windowMinutes);
    console.log(
      `[reconciliation] ${mode} run ${result.runId}: checked ${result.recordsChecked} records, ` +
      `found ${result.discrepanciesFound.length} discrepancies, lag ${result.reconciliationLagMs}ms`,
    );
    await evaluateAndFireAlerts(result);
  } catch (err) {
    // A failed reconciliation run is itself an incident — never let it fail silently.
    console.error(`[reconciliation] ${mode} run threw an error:`, err);
    await evaluateAndFireAlerts(null, err as Error);
  }
}

/** Exposed for the injected-discrepancy test and for a manual "run now" ops endpoint. */
export async function runReconciliationNow(mode: 'sliding_window' | 'full_sweep' = 'sliding_window') {
  return runReconciliationSafely(mode);
}