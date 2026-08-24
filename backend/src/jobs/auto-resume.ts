import cron, { type ScheduledTask } from 'node-cron';
import { supabase, databaseRepository } from '../config/database';
import { subscriptionService } from '../services/subscription-service';
import logger from '../config/logger';
import { jobAlertService } from '../services/job-alert-service';

let autoResumeTask: ScheduledTask | null = null;

/**
 * Auto-Resume Cron Job
 * Runs daily at 6:00 AM — resumes subscriptions whose resume_at date has passed
 */
export function scheduleAutoResume(): void {
  autoResumeTask = cron.schedule('0 6 * * *', async () => {
    logger.info('[auto-resume] Running scheduled auto-resume job');

    try {
      await jobAlertService.runMonitoredJob('auto-resume', async () => {
        const { data: toResume, error } = await databaseRepository
          .from('subscriptions')
          .select('id, user_id')
          .eq('status', 'paused')
          .not('resume_at', 'is', null)
          .lte('resume_at', new Date().toISOString());

        if (error) {
          throw error;
        }

        if (!toResume || toResume.length === 0) {
          logger.info('[auto-resume] No subscriptions to auto-resume today');
          return;
        }

        logger.info(`[auto-resume] Found ${toResume.length} subscription(s) to resume`);

        for (const sub of toResume) {
          try {
            await subscriptionService.resumeSubscription(sub.user_id, sub.id);
            logger.info(`[auto-resume] Resumed subscription ${sub.id}`);
          } catch (err) {
            // Log the failure but keep going — don't let one failure stop the rest
            logger.error(`[auto-resume] Failed to resume subscription ${sub.id}:`, err);
          }
        }

        logger.info('[auto-resume] Job complete');
      });
    } catch (err) {
      logger.error('[auto-resume] Unexpected error:', err);
    }
  });

  logger.info('[auto-resume] Cron job scheduled — runs daily at 6:00 AM');
}

export function stopAutoResume(): void {
  if (autoResumeTask) {
    autoResumeTask.stop();
    autoResumeTask = null;
    logger.info('[auto-resume] Cron job stopped');
  }
}
