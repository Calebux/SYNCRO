import cron from 'node-cron';
import { reminderEngine } from '../services/reminder-engine';
import { notificationPreferenceService } from '../services/notification-preference-service';
import { checkBudgetAlertsForUsers } from '../services/budget-alert-service';
import logger from '../config/logger';
import { runWithCorrelationId } from '../middleware/requestContext';

/**
 * Daily cron jobs for reminder processing.
 * Runs at midnight UTC every day.
 */

// Auto-unmute expired snoozes — runs at 00:00 UTC daily
cron.schedule('0 0 * * *', () =>
  runWithCorrelationId('cron:expired-snoozes', async (cid) => {
    logger.info('Cron: processing expired snoozes', { correlationId: cid });
    try {
      await notificationPreferenceService.processExpiredSnoozes();
      logger.info('Cron: expired snoozes processed successfully');
    } catch (error) {
      logger.error('Cron: failed to process expired snoozes:', error);
    }
  }),
);

// Schedule reminders — runs at 08:00 UTC daily
cron.schedule('0 8 * * *', () =>
  runWithCorrelationId('cron:schedule-reminders', async (cid) => {
    logger.info('Cron: scheduling reminders', { correlationId: cid });
    try {
      await reminderEngine.scheduleReminders();
      logger.info('Cron: reminders scheduled successfully');
    } catch (error) {
      logger.error('Cron: failed to schedule reminders:', error);
    }
  }),
);

// Process pending reminders — runs at 09:00 UTC daily
cron.schedule('0 9 * * *', () =>
  runWithCorrelationId('cron:process-reminders', async (cid) => {
    logger.info('Cron: processing reminders', { correlationId: cid });
    try {
      await reminderEngine.processReminders();
      logger.info('Cron: reminders processed successfully');
    } catch (error) {
      logger.error('Cron: failed to process reminders:', error);
    }
  }),
);

// Process delivery retries — runs every 30 minutes
cron.schedule('*/30 * * * *', () =>
  runWithCorrelationId('cron:retries', async (cid) => {
    logger.info('Cron: processing retries', { correlationId: cid });
    try {
      await reminderEngine.processRetries();
      logger.info('Cron: retries processed successfully');
    } catch (error) {
      logger.error('Cron: failed to process retries:', error);
    }
  }),
);

// Budget alerts — runs at 10:00 UTC daily
cron.schedule('0 10 * * *', () =>
  runWithCorrelationId('cron:budget-alerts', async (cid) => {
    logger.info('Cron: checking budget alerts', { correlationId: cid });
    try {
      // Batched: fans out over every user with a budget in a fixed number of
      // queries rather than one round of queries per user (issue #1095).
      await checkBudgetAlertsForUsers();
      logger.info('Cron: budget alerts processed');
    } catch (error) {
      logger.error('Cron: failed to process budget alerts:', error);
    }
  }),
);

logger.info('Cron jobs registered');