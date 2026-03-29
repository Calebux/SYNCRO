import cron from 'node-cron';
import logger from '../config/logger';
import { reminderEngine } from './reminder-engine';
import { riskDetectionService } from './risk-detection/risk-detection-service';
import { expiryService } from './expiry-service';
import { renewalLockService } from './renewal-lock-service';
import { digestService } from './digest-service';
import { webhookService } from './webhook-service';

export class SchedulerService {
  private jobs: cron.ScheduledTask[] = [];

  start(): void {
    logger.info('Starting scheduler service');

    // ── Daily at 9 AM UTC: process pending reminders ──────────────────────
    this.jobs.push(
      cron.schedule('0 9 * * *', async () => {
        logger.info('Running scheduled reminder processing');
        try {
          await reminderEngine.processReminders();
        } catch (error) {
          logger.error('Error in scheduled reminder processing:', error);
        }
      }),
    );

    // ── Daily at midnight UTC: schedule upcoming reminders ────────────────
    this.jobs.push(
      cron.schedule('0 0 * * *', async () => {
        logger.info('Running scheduled reminder scheduling');
        try {
          await reminderEngine.scheduleReminders();
          await reminderEngine.scheduleTrialReminders();
        } catch (error) {
          logger.error('Error in scheduled reminder scheduling:', error);
        }
      }),
    );

    // ── Every 30 minutes: retry failed deliveries ─────────────────────────
    this.jobs.push(
      cron.schedule('*/30 * * * *', async () => {
        logger.info('Running scheduled retry processing');
        try {
          await reminderEngine.processRetries();
        } catch (error) {
          logger.error('Error in scheduled retry processing:', error);
        }
      }),
    );

    // ── Daily at 2 AM UTC: risk recalculation ────────────────────────────
    this.jobs.push(
      cron.schedule('0 2 * * *', async () => {
        logger.info('Running scheduled risk recalculation');
        try {
          const result = await riskDetectionService.recalculateAllRisks();
          logger.info('Risk recalculation completed', {
            total:       result.total,
            successful:  result.successful,
            failed:      result.failed,
            duration_ms: result.duration_ms,
          });
        } catch (error) {
          logger.error('Error in scheduled risk recalculation:', error);
        }
      }),
    );

    // ── Daily at 2 AM UTC: expiry processing ─────────────────────────────
    this.jobs.push(
      cron.schedule('0 2 * * *', async () => {
        logger.info('Running scheduled expiry processing');
        try {
          await expiryService.processExpiries();
        } catch (error) {
          logger.error('Error in scheduled expiry processing:', error);
        }
      }),
    );

    // ── Every 5 minutes: renewal lock cleanup ────────────────────────────
    this.jobs.push(
      cron.schedule('*/5 * * * *', async () => {
        try {
          await renewalLockService.releaseExpiredLocks();
        } catch (error) {
          logger.error('Error in scheduled renewal lock cleanup:', error);
        }
      }),
    );

    // ── Every 5 minutes: webhook retry processing ───────────────────────
    this.jobs.push(
      cron.schedule('*/5 * * * *', async () => {
        logger.info('Running scheduled webhook retry processing');
        try {
          await webhookService.processRetries();
        } catch (error) {
          logger.error('Error in scheduled webhook retry processing:', error);
        }
      }),
    );

    // ── 1st of every month at 8 AM UTC: monthly digest ───────────────────
    // Cron: minute=0, hour=8, day=1, month=*, weekday=*
    this.jobs.push(
      cron.schedule('0 8 1 * *', async () => {
        logger.info('Running monthly digest job');
        try {
          const result = await digestService.runMonthlyDigest();
          logger.info('Monthly digest job completed', result);
        } catch (error) {
          logger.error('Error in monthly digest job:', error);
        }
      }),
    );

    logger.info(`Started ${this.jobs.length} scheduled jobs`);
  }

  stop(): void {
    logger.info('Stopping scheduler service');
    this.jobs.forEach((job) => job.stop());
    this.jobs = [];
    logger.info('Scheduler service stopped');
  }

  getStatus(): { running: boolean; jobCount: number } {
    return {
      running:  this.jobs.length > 0,
      jobCount: this.jobs.length,
    };
  }
}

export const schedulerService = new SchedulerService();