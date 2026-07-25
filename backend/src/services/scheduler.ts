import cron from 'node-cron';
import logger from '../config/logger';
import { reminderEngine } from './reminder-engine';
import { riskDetectionService } from './risk-detection/risk-detection-service';
import { expiryService } from './expiry-service';
import { renewalLockService } from './renewal-lock-service';
import { digestService } from './digest-service';
import { webhookService } from './webhook-service';
import { complianceService } from './compliance-service';
import { supabase } from '../config/database';
import { suggestionService } from './suggestion-service';
import { idempotencyService } from './idempotency';
import { subscriptionService } from './subscription-service';
import { jobAlertService } from './job-alert-service';
import { agentWalletRotationService } from './agent-wallet-rotation';
import { telegramNotificationService } from './telegram-notification-service';

export class SchedulerService {
  private jobs: cron.ScheduledTask[] = [];

  start(): void {
    logger.info('Starting scheduler service');

    // ── Daily at 9 AM UTC: process pending reminders ──────────────────────
    this.jobs.push(
      cron.schedule('0 9 * * *', async () => {
        logger.info('Running scheduled reminder processing');
        try {
          await jobAlertService.runMonitoredJob('reminder-processing', () =>
            reminderEngine.processReminders(),
          );
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
          await jobAlertService.runMonitoredJob('reminder-scheduling', async () => {
            await reminderEngine.scheduleReminders();
            await reminderEngine.scheduleTrialReminders();
          });
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
          await jobAlertService.runMonitoredJob('reminder-retries', () =>
            reminderEngine.processRetries(),
          );
        } catch (error) {
          logger.error('Error in scheduled retry processing:', error);
        }
      }),
    );

    // ── Every 15 minutes: process delayed notifications ───────────────────
    this.jobs.push(
      cron.schedule('*/15 * * * *', async () => {
        logger.info('Running delayed notification processing');
        try {
          await reminderEngine.processDelayedNotifications();
        } catch (error) {
          logger.error('Error in delayed notification processing:', error);
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
          await jobAlertService.runMonitoredJob('expiry-processing', () =>
            expiryService.processExpiries(),
          );
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
          await jobAlertService.runMonitoredJob('webhook-retries', () =>
            webhookService.processRetries(),
          );
        } catch (error) {
          logger.error('Error in scheduled webhook retry processing:', error);
        }
      }),
    );

    // ── Weekly on Monday at 9 AM UTC: Telegram spending summaries ────────
    this.jobs.push(
      cron.schedule('0 9 * * 1', async () => {
        logger.info('Running weekly Telegram spending summaries');
        try {
          await jobAlertService.runMonitoredJob('telegram-weekly-summary', () =>
            telegramNotificationService.sendWeeklySummariesToAllUsers(),
          );
        } catch (error) {
          logger.error('Error in weekly Telegram summary job:', error);
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

    // ── Daily at 3 AM UTC: process account hard deletes ─────────────────
    this.jobs.push(
      cron.schedule('0 3 * * *', async () => {
        logger.info('Running account hard delete job');
        try {
          const processed = await complianceService.processHardDeletes();
          logger.info(`Hard delete job completed: ${processed} accounts processed`);
        } catch (error) {
          logger.error('Error in hard delete job:', error);
        }
      }),
    );

    // ── Daily at 3:30 AM UTC: soft-delete retention cleanup ──────────────
    this.jobs.push(
      cron.schedule('30 3 * * *', async () => {
        logger.info('Running soft-delete retention cleanup');
        try {
          const { deletedCount } = await subscriptionService.purgeDeletedSubscriptions(30);
          logger.info(`Retention cleanup completed: purged ${deletedCount} subscriptions`);
        } catch (error) {
          logger.error('Error in soft-delete retention cleanup:', error);
        }
      }),
    );

    // ── Nightly at 1 AM UTC: pre-compute smart suggestions ───────────────
    this.jobs.push(
      cron.schedule('0 1 * * *', async () => {
        logger.info('Running nightly suggestion generation');
        try {
          // Fetch all active user IDs and warm suggestions (errors per user are non-fatal)
          const { data: users } = await supabase
            .from('profiles')
            .select('id');
          let count = 0;
          for (const user of users ?? []) {
            try {
              await suggestionService.generateSuggestions(user.id);
              count++;
            } catch {
              // individual user failure is non-fatal
            }
          }
          logger.info(`Nightly suggestion generation completed for ${count} users`);
        } catch (error) {
          logger.error('Error in nightly suggestion generation:', error);
        }
      }),
    );

    // ── Daily at 1 AM UTC: idempotency key cleanup ───────────────────────
    this.jobs.push(
      cron.schedule('0 1 * * *', async () => {
        logger.info('Running idempotency key cleanup');
        try {
          const deleted = await idempotencyService.cleanupExpiredKeys();
          logger.info(`Idempotency key cleanup completed: ${deleted} keys deleted`);
        } catch (error) {
          logger.error('Error in idempotency key cleanup:', error);
        }
      }),
    );

    // ── Agent wallet rotation ─────────────────────────────────────────────
    // The rotation service respects AGENT_ROTATION_SCHEDULE. When the schedule
    // is "daily" or "weekly" the cron fires at the appropriate cadence but the
    // service itself decides whether a rotation is actually due, so running
    // both jobs is safe — the extra trigger for weekly rotations is a no-op
    // on non-rotation days.

    // Daily check at 00:05 UTC (shortly after midnight to avoid contention)
    this.jobs.push(
      cron.schedule('5 0 * * *', async () => {
        logger.info('Running daily agent wallet rotation check');
        try {
          const results = await agentWalletRotationService.rotateAll(false);
          if (results.length > 0) {
            logger.info(`Agent wallet rotation: rotated ${results.length} agent(s)`, {
              agents: results.map((r) => r.agentName),
            });
          } else {
            logger.info('Agent wallet rotation: no rotations due');
          }
        } catch (error) {
          logger.error('Error in agent wallet rotation job:', error);
        }
      }),
    );

    // Weekly check on Mondays at 00:10 UTC (belt-and-suspenders for weekly schedule)
    this.jobs.push(
      cron.schedule('10 0 * * 1', async () => {
        logger.info('Running weekly agent wallet rotation check');
        try {
          const results = await agentWalletRotationService.rotateAll(false);
          if (results.length > 0) {
            logger.info(`Agent wallet rotation (weekly): rotated ${results.length} agent(s)`, {
              agents: results.map((r) => r.agentName),
            });
          }
        } catch (error) {
          logger.error('Error in weekly agent wallet rotation job:', error);
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
