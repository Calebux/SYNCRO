import cron from 'node-cron';
import { reminderEngine } from '../services/reminder-engine';
import { notificationPreferenceService } from '../services/notification-preference-service';
import logger from '../config/logger';

/**
 * Daily cron jobs for reminder processing.
 * Runs at midnight UTC every day.
 */

// Auto-unmute expired snoozes — runs at 00:00 UTC daily
cron.schedule('0 0 * * *', async () => {
  logger.info('Cron: processing expired snoozes');
  try {
    await notificationPreferenceService.processExpiredSnoozes();
    logger.info('Cron: expired snoozes processed successfully');
  } catch (error) {
    logger.error('Cron: failed to process expired snoozes:', error);
  }
});

// Schedule reminders — runs at 08:00 UTC daily
cron.schedule('0 8 * * *', async () => {
  logger.info('Cron: scheduling reminders');
  try {
    await reminderEngine.scheduleReminders();
    logger.info('Cron: reminders scheduled successfully');
  } catch (error) {
    logger.error('Cron: failed to schedule reminders:', error);
  }
});

// Process pending reminders — runs at 09:00 UTC daily
cron.schedule('0 9 * * *', async () => {
  logger.info('Cron: processing reminders');
  try {
    await reminderEngine.processReminders();
    logger.info('Cron: reminders processed successfully');
  } catch (error) {
    logger.error('Cron: failed to process reminders:', error);
  }
});

// Process delivery retries — runs every 30 minutes
cron.schedule('*/30 * * * *', async () => {
  logger.info('Cron: processing retries');
  try {
    await reminderEngine.processRetries();
    logger.info('Cron: retries processed successfully');
  } catch (error) {
    logger.error('Cron: failed to process retries:', error);
  }
});

logger.info('Cron jobs registered');