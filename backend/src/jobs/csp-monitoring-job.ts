/**
 * CSP Monitoring Cron Job
 * 
 * Periodically refreshes CSP violation statistics and checks for alert conditions.
 * 
 * Schedule:
 * - Stats refresh: Every 5 minutes
 * - Alert checks: Every 5 minutes
 * - Cleanup old violations: Daily at 2 AM
 */

import cron from 'node-cron';
import {
    refreshCspViolationStats,
    checkCspAlerts,
    cleanupOldCspViolations,
} from '../services/csp-monitoring';
import logger from '../config/logger';
import { env } from '../config/env';

/**
 * Refresh CSP violation statistics
 * Runs every 5 minutes
 */
export const cspStatsRefreshJob = cron.schedule('*/5 * * * *', async () => {
    try {
        logger.info('Starting CSP stats refresh job');
        const success = await refreshCspViolationStats();

        if (success) {
            logger.info('CSP stats refresh job completed successfully');
        } else {
            logger.error('CSP stats refresh job failed');
        }
    } catch (error) {
        logger.error('Exception in CSP stats refresh job', { error });
    }
}, {
    scheduled: false, // Don't start automatically, will be started manually
});

/**
 * Check for CSP alert conditions
 * Runs every 5 minutes
 */
export const cspAlertCheckJob = cron.schedule('*/5 * * * *', async () => {
    try {
        logger.info('Starting CSP alert check job');
        await checkCspAlerts();
        logger.info('CSP alert check job completed successfully');
    } catch (error) {
        logger.error('Exception in CSP alert check job', { error });
    }
}, {
    scheduled: false,
});

/**
 * Cleanup old CSP violations
 * Runs daily at 2 AM
 */
export const cspCleanupJob = cron.schedule('0 2 * * *', async () => {
    try {
        logger.info('Starting CSP cleanup job');
        const deletedCount = await cleanupOldCspViolations(90); // Keep 90 days
        logger.info(`CSP cleanup job completed, deleted ${deletedCount} old violations`);
    } catch (error) {
        logger.error('Exception in CSP cleanup job', { error });
    }
}, {
    scheduled: false,
});

/**
 * Start all CSP monitoring jobs
 */
export function startCspMonitoringJobs(): void {
    const enabled = env.CSP_MONITORING_ENABLED !== 'false';

    if (!enabled) {
        logger.info('CSP monitoring jobs are disabled');
        return;
    }

    logger.info('Starting CSP monitoring jobs');

    cspStatsRefreshJob.start();
    cspAlertCheckJob.start();
    cspCleanupJob.start();

    logger.info('CSP monitoring jobs started successfully');
}

/**
 * Stop all CSP monitoring jobs
 */
export function stopCspMonitoringJobs(): void {
    logger.info('Stopping CSP monitoring jobs');

    cspStatsRefreshJob.stop();
    cspAlertCheckJob.stop();
    cspCleanupJob.stop();

    logger.info('CSP monitoring jobs stopped');
}
