import logger from '../config/logger';
import { telegramBotService } from './telegram-bot-service';
import { userPreferenceService } from './user-preference-service';
import { V3NotificationEventType, V3EventPayload } from '../types/v3-notifications';
import { v3NotificationDispatch } from './v3-notification-dispatch';

/**
 * Telegram notification delivery — subscription content removed in v3.
 * Exposes thin wrappers that route through v3 dispatch preferences.
 */
export class TelegramNotificationService {
  async isTelegramEnabled(userId: string): Promise<boolean> {
    const prefs = await userPreferenceService.getPreferences(userId);
    return prefs.notification_channels.includes('telegram');
  }

  async sendPaymentConfirmation(): Promise<void> {
    logger.warn('[TelegramNotificationService] sendPaymentConfirmation deprecated — subscription payment confirmations removed in v3.');
  }

  async sendWeeklySpendingSummary(): Promise<void> {
    logger.warn('[TelegramNotificationService] sendWeeklySpendingSummary deprecated — subscription summaries removed in v3.');
  }

  async sendWeeklySummariesToAllUsers(): Promise<number> {
    logger.warn('[TelegramNotificationService] sendWeeklySummariesToAllUsers deprecated — subscription summaries removed in v3.');
    return 0;
  }

  async sendV3(
    userId: string,
    eventType: V3NotificationEventType,
    payload: V3EventPayload,
  ): Promise<void> {
    await v3NotificationDispatch.dispatch({
      eventType,
      targetUserId: userId,
      payload,
    });
  }
}

export const telegramNotificationService = new TelegramNotificationService();
