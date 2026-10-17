/**
 * Operator alerting for counter-store degraded transitions (Issue #1444).
 *
 * Two channels, deliberately:
 *
 *  - **Logs**, synchronously, at `error` on entry and at `warn` on exit. The
 *    entry line carries the outage id, the exposure budget, and what to do
 *    about it, so an on-call reading a log stream sees the outage the moment
 *    it starts rather than when revenue is reconciled days later.
 *  - **v3 operator notifications + audit**, asynchronously and best-effort.
 *    The notification is the Slack page; the `system.degraded_mode` audit
 *    entry is what the console renders as a "Degraded metering" alert and
 *    what reconciliation later uses to find the outage window.
 *
 * Nothing here may fail the admission path: every dispatch is swallowed and
 * logged, because alerting that can take down the thing it alerts on is worse
 * than no alerting.
 */

import logger from '../config/logger';
import type { DegradedEvent } from '../../../packages/metering/src/degraded-admission';

/**
 * The ops side-channel (v3 notifications + audit) reaches services whose env
 * is validated at import time, which tests deliberately do not provide. The
 * log channel above is always on; the ops channel is skipped under test.
 */
const OPS_ANNOUNCE_ENABLED = process.env.NODE_ENV !== 'test';

/** Name used for the counter store in notifications and audit details. */
export const COUNTER_STORE_DEPENDENCY = 'counter-store';

export function createDegradedAlertHandler(): (event: DegradedEvent) => void {
  return (event: DegradedEvent): void => {
    switch (event.type) {
      case 'entered':
        logger.error(
          '[Metering] DEGRADED MODE ENTERED — counter store unavailable; serving per-provider fail-open/fail-closed policy',
          {
            outageId: event.outageId,
            at: event.at,
            exposureCeilingSpend: event.exposureUsed,
            degradedCalls: event.degradedCalls,
            rejectedCalls: event.rejectedCalls,
          },
        );
        void announce('degraded_mode_entered', event, 'degraded');
        break;

      case 'exited':
        logger.warn('[Metering] Degraded mode exited — counter store recovered', {
          outageId: event.outageId,
          at: event.at,
          exposureServedUnbilled: event.exposureUsed,
          degradedCalls: event.degradedCalls,
          rejectedCalls: event.rejectedCalls,
          action: 'reconcile the degraded usage log before settling',
        });
        void announce('degraded_mode_exited', event, 'healthy');
        break;

      case 'ceiling_exhausted':
        logger.error(
          '[Metering] Unbilled exposure ceiling reached — provider now failing closed for the rest of the outage',
          {
            outageId: event.outageId,
            providerId: event.providerId,
            exposureCeiling: event.exposureCeiling,
            exposureUsed: event.exposureUsed,
          },
        );
        break;
    }
  };
}

/**
 * Fire the operator notification and the audit entry for a transition.
 * Both are best-effort; failures are logged, never thrown.
 */
async function announce(
  eventType: 'degraded_mode_entered' | 'degraded_mode_exited',
  event: DegradedEvent,
  storeStatus: 'degraded' | 'healthy',
): Promise<void> {
  if (!OPS_ANNOUNCE_ENABLED) {
    return;
  }

  const entered = eventType === 'degraded_mode_entered';
  const payload = {
    timestamp: event.at,
    dependencies: [
      {
        name: COUNTER_STORE_DEPENDENCY,
        status: storeStatus,
        error: storeStatus === 'degraded' ? 'counter store unavailable' : undefined,
      },
    ],
    previousState: entered ? ('healthy' as const) : ('degraded' as const),
    newState: entered ? ('degraded' as const) : ('healthy' as const),
  };

  try {
    const { v3NotificationDispatch } = await import('../services/v3-notification-dispatch');
    await v3NotificationDispatch.dispatch({ eventType, payload });
  } catch (err) {
    logger.error('[Metering] degraded transition notification failed', {
      eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { auditDegradedMode } = await import('../services/audit-service');
    await auditDegradedMode('system', {
      eventType: 'degraded_mode',
      before: { state: payload.previousState },
      after: { state: payload.newState },
      details: {
        outageId: event.outageId,
        source: COUNTER_STORE_DEPENDENCY,
        exposureServedUnbilled: event.exposureUsed,
        degradedCalls: event.degradedCalls,
        rejectedCalls: event.rejectedCalls,
      },
    });
  } catch (err) {
    logger.error('[Metering] degraded transition audit failed', {
      eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
