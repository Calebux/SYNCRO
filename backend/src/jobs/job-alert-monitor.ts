/**
 * Periodic job failure alert monitor.
 * Evaluates critical job thresholds every 5 minutes.
 */

import cron from 'node-cron';
import { jobAlertService } from '../services/job-alert-service';
import { eventListener } from '../services/event-listener';
import logger from '../config/logger';
import { env } from '../config/env';

export const jobAlertMonitorJob = cron.schedule(
  '*/5 * * * *',
  async () => {
    try {
      const elHealth = eventListener.getHealth();
      jobAlertService.setExternalMetrics('event-listener', {
        consecutiveFailures: elHealth.consecutiveErrors,
      });

      const alerts = await jobAlertService.checkAndEmitAlerts();
      if (alerts.length > 0) {
        logger.info('Job alert monitor completed with active alerts', {
          alertCount: alerts.length,
          jobs: [...new Set(alerts.map((a) => a.jobId))],
        });
      }
    } catch (error) {
      logger.error('Job alert monitor failed', { error });
      jobAlertService.recordJobOutcome('job-alert-monitor', false, error);
    }
  },
  { scheduled: false },
);

export function startJobAlertMonitor(): void {
  const enabled = env.JOB_ALERT_MONITOR_ENABLED !== 'false';
  if (!enabled) {
    logger.info('Job alert monitor is disabled');
    return;
  }

  jobAlertMonitorJob.start();
  logger.info('Job alert monitor started (every 5 minutes)');
}

export function stopJobAlertMonitor(): void {
  jobAlertMonitorJob.stop();
}
