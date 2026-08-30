import logger from '../config/logger';
import { env } from '../config/env';
import { NotificationPayload, DeliveryResult } from '../types/reminder';
import { ExternalServiceClient } from '../utils/external-service-client';
import { withRetry, NonRetryableError } from '../utils/retry';
import { sanitizeUrl } from '../utils/sanitize-url';

export interface TelegramConfig {
  botToken: string;
  apiUrl?: string;
}

export interface TelegramUser {
  userId: string;
  chatId: string;
}

export class TelegramBotService {
  private botToken: string | null = null;
  private apiUrl: string;
  private client = new ExternalServiceClient('telegram');

  constructor(config?: TelegramConfig) {
    this.botToken = config?.botToken || env.TELEGRAM_BOT_TOKEN || null;
    this.apiUrl = config?.apiUrl || 'https://api.telegram.org';

    if (!this.botToken && env.NODE_ENV !== 'development') {
      logger.warn('[TelegramBotService] Telegram bot token not configured. Telegram notifications will not be sent.');
    }
  }

  /**
   * Determine whether a Telegram send failure should be retried.
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof NonRetryableError) {
      return false;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const nonRetryablePatterns = [
      /bot was blocked/i,
      /chat not found/i,
      /unauthorized/i,
      /forbidden/i,
      /bad request/i,
      /status 400/i,
      /status 401/i,
      /status 403/i,
      /status 404/i,
    ];

    return !nonRetryablePatterns.some((pattern) => pattern.test(errorMessage));
  }

  /**
   * Check if Telegram service is configured
   */
  isConfigured(): boolean {
    return !!this.botToken;
  }

  /**
   * Verify bot token and connection
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.botToken) {
      logger.warn('[TelegramBotService] Cannot verify connection: bot token not configured');
      return false;
    }

    try {
      const response = await fetch(`${this.apiUrl}/bot${this.botToken}/getMe`);

      const responseOk = typeof response.ok === 'boolean' ? response.ok : true;
      const responseStatus = typeof response.status === 'number' ? response.status : 200;

      if (!responseOk) {
        logger.error('[TelegramBotService] Connection verification failed', {
          error: `HTTP ${responseStatus}`,
        });
        return false;
      }

      const data = await response.json();

      if (data.ok) {
        logger.info('[TelegramBotService] Connection verified', {
          botUsername: data.result.username,
          botId: data.result.id,
        });
        return true;
      } else {
        logger.error('[TelegramBotService] Connection verification failed', {
          error: data.description,
        });
        return false;
      }
    } catch (error) {
      logger.error('[TelegramBotService] Connection verification error:', error);
      return false;
    }
  }

  /**
   * Send a message to a Telegram chat
   */
  private async sendMessage(
    chatId: string,
    text: string,
    options: {
      parseMode?: 'Markdown' | 'HTML';
      disableWebPagePreview?: boolean;
      replyMarkup?: any;
      maxAttempts?: number;
    } = {}
  ): Promise<any> {
    if (!this.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || 'HTML',
      disable_web_page_preview: options.disableWebPagePreview ?? false,
    };

    if (options.replyMarkup) {
      payload.reply_markup = options.replyMarkup;
    }

    const data = await this.client.request<any>(`${this.apiUrl}/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      maxAttempts: options.maxAttempts,
    });

    if (!data.ok) {
      const errorMessage = data.description || 'Telegram API error';
      const errorCode = typeof data.error_code === 'number' ? data.error_code : undefined;

      if (errorCode && errorCode >= 400 && errorCode < 500 && errorCode !== 429) {
        throw new NonRetryableError(`Telegram API error: ${errorMessage}`);
      }

      throw new Error(`Telegram API error: ${errorMessage}`);
    }

    return data.result;
  }

  /**
   * Get chat ID for a user (from database or user mapping)
   */
  private async getChatIdForUser(userId: string): Promise<string | null> {
    try {
      const { supabase, databaseRepository } = await import('../config/database');

      const { data, error } = await databaseRepository
        .from('user_telegram_connections')
        .select('chat_id')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - user hasn't connected Telegram
          logger.debug(`[TelegramBotService] No Telegram connection found for user ${userId}`);
          return null;
        }
        logger.error(`[TelegramBotService] Error fetching chat ID for user ${userId}:`, error);
        return null;
      }

      return data?.chat_id || null;
    } catch (error) {
      logger.error(`[TelegramBotService] Failed to lookup chat ID for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Send renewal reminder via Telegram with retry logic
   */
  async sendRenewalReminder(
    userId: string,
    payload: NotificationPayload,
    chatId?: string,
    options: { maxAttempts?: number } = {}
  ): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      logger.warn('[TelegramBotService] Telegram not configured, skipping notification');
      return {
        success: false,
        error: 'Telegram bot token not configured',
        metadata: {
          retryable: false,
        },
      };
    }

    try {
      const maxAttempts = options.maxAttempts || 3;

      return await withRetry(
        async () => {
          // Get chat ID if not provided
          const targetChatId = chatId || await this.getChatIdForUser(userId);

          if (!targetChatId) {
            logger.warn(`[TelegramBotService] No Telegram chat ID found for user ${userId}`);
            throw new NonRetryableError('User has not connected Telegram account');
          }

          const message = this.formatReminderMessage(payload);
          const buttons = this.getReminderButtons(payload);

          const result = await this.sendMessage(targetChatId, message, {
            parseMode: 'HTML',
            disableWebPagePreview: false,
            replyMarkup: buttons,
            maxAttempts: 1,
          });

          logger.info(`[TelegramBotService] Reminder sent successfully to user ${userId}`, {
            messageId: result.message_id,
            chatId: targetChatId,
          });

          return {
            success: true,
            metadata: {
              messageId: result.message_id,
              chatId: targetChatId,
            },
          };
        },
        { maxAttempts }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(`[TelegramBotService] Failed to send reminder to user ${userId}:`, {
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
        metadata: {
          retryable: this.isRetryableError(error),
        },
      };
    }
  }

  /**
   * Format reminder message for Telegram
   */
  private formatReminderMessage(payload: NotificationPayload): string {
    const { subscription, daysBefore, renewalDate, reminderType } = payload;

    const renewalDateFormatted = new Date(renewalDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    if (reminderType === 'trial_expiry') {
      const emoji = daysBefore === 0 ? '🚨' : daysBefore <= 1 ? '⚠️' : '📅';
      const urgency = daysBefore === 0 ? 'TODAY' : `in ${daysBefore} day${daysBefore > 1 ? 's' : ''}`;
      const convertPrice = subscription.trial_converts_to_price ?? subscription.price ?? 0;

      let message = `${emoji} <b>Trial Ending ${urgency}</b>\n\n`;
      message += `<b>${subscription.name || 'Subscription'}</b>\n`;
      message += `📦 Category: ${subscription.category || 'N/A'}\n`;
      message += `📅 Trial ends: ${renewalDateFormatted}\n\n`;

      if (subscription.credit_card_required) {
        message += `⚠️ <b>Action Required:</b> You'll be charged <b>$${Number(convertPrice).toFixed(2)}/${subscription.billing_cycle || 'period'}</b> if you don't cancel.\n`;
      } else {
        message += `ℹ️ No credit card on file. Your access will end if you don't upgrade.\n`;
      }

      return message;
    }

    // Regular renewal reminder
    const emoji = daysBefore === 0 ? '🔔' : daysBefore <= 3 ? '⚠️' : '📅';
    const timeframe = daysBefore === 0 ? 'TODAY' : `in ${daysBefore} day${daysBefore > 1 ? 's' : ''}`;

    let message = `${emoji} <b>Subscription Renewal ${timeframe}</b>\n\n`;
    message += `<b>${subscription.name || 'Subscription'}</b>\n`;
    message += `📦 Category: ${subscription.category || 'N/A'}\n`;
    message += `💰 Price: $${Number(subscription.price || 0).toFixed(2)}/${subscription.billing_cycle || 'period'}\n`;
    message += `📅 Renewal: ${renewalDateFormatted}\n`;

    if (daysBefore > 0) {
      message += `⏰ Days remaining: ${daysBefore}\n`;
    }

    return message;
  }

  /**
   * Get inline keyboard buttons for reminder
   */
  private getReminderButtons(payload: NotificationPayload): any {
    const { subscription } = payload;
    const buttons: any[][] = [];

    // Add manage subscription button if URL is available
    if (subscription.renewal_url) {
      const safeUrl = sanitizeUrl(subscription.renewal_url);
      buttons.push([
        {
          text: '🔗 Manage Subscription',
          url: safeUrl,
        },
      ]);
    }

    // Add view in app button
    const appUrl = env.FRONTEND_URL;
    buttons.push([
      {
        text: '📱 View in SYNCRO',
        url: `${appUrl}/dashboard`,
      },
    ]);

    return buttons.length > 0 ? { inline_keyboard: buttons } : undefined;
  }

  /**
   * Send a simple text message to a user
   */
  async sendSimpleMessage(
    userId: string,
    message: string,
    chatId?: string,
    options: { maxAttempts?: number } = {}
  ): Promise<DeliveryResult> {
    const { maxAttempts = 3 } = options;

    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Telegram bot token not configured',
        metadata: { retryable: false },
      };
    }

    try {
      const targetChatId = chatId || await this.getChatIdForUser(userId);

      if (!targetChatId) {
        return {
          success: false,
          error: 'User has not connected Telegram account',
          metadata: { retryable: false },
        };
      }

      return await withRetry(
        async () => {
          const result = await this.sendMessage(targetChatId, message, {
            parseMode: 'HTML',
          });

          logger.info(`[TelegramBotService] Message sent to user ${userId}`, {
            messageId: result.message_id,
          });

          return {
            success: true,
            metadata: {
              messageId: result.message_id,
              chatId: targetChatId,
            },
          };
        },
        { maxAttempts }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRetryable = this.isRetryableError(error);

      logger.error(`[TelegramBotService] Failed to send message to user ${userId}:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: isRetryable },
      };
    }
  }

  /**
   * Send risk alert via Telegram
   */
  async sendRiskAlert(
    userId: string,
    payload: {
      subscriptionName: string;
      riskFactors: any[];
      renewalDate: string;
      recommendedAction: string;
    },
    chatId?: string
  ): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Telegram bot token not configured',
        metadata: { retryable: false },
      };
    }

    const targetChatId = chatId || await this.getChatIdForUser(userId);

    if (!targetChatId) {
      return {
        success: false,
        error: 'User has not connected Telegram account',
        metadata: { retryable: false },
      };
    }

    try {
      const factorsText = payload.riskFactors
        .map((f, i) => `${i + 1}. ${this.getFactorDescription(f)}`)
        .join('\n');

      const message = `
🚨 <b>Risk Alert</b>

⚠️ <b>${payload.subscriptionName}</b> renewal at risk

<b>Risk Factors:</b>
${factorsText}

<b>Recommendation:</b> ${payload.recommendedAction}

📅 Renewal Date: ${new Date(payload.renewalDate).toLocaleDateString()}
      `.trim();

      const buttons = {
        inline_keyboard: [
          [
            {
              text: '📱 Review Subscription',
              url: `${env.FRONTEND_URL}/dashboard`,
            },
          ],
        ],
      };

      const result = await this.sendMessage(targetChatId, message, {
        parseMode: 'HTML',
        replyMarkup: buttons,
      });

      logger.info(`[TelegramBotService] Risk alert sent to user ${userId}`, {
        messageId: result.message_id,
      });

      return {
        success: true,
        metadata: {
          messageId: result.message_id,
          chatId: targetChatId,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[TelegramBotService] Failed to send risk alert to user ${userId}:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: this.isRetryableError(error) },
      };
    }
  }

  /**
   * Helper to get human-readable factor description
   */
  private getFactorDescription(factor: any): string {
    switch (factor.factor_type) {
      case 'consecutive_failures':
        return `${factor.details?.count || 0} consecutive payment failures`;
      case 'balance_projection':
        return 'Insufficient projected balance';
      case 'approval_expiration':
        return `Payment approval expires ${new Date(factor.details?.expires_at).toLocaleDateString()}`;
      default:
        return String(factor.factor_type).replace(/_/g, ' ');
    }
  }
}

export const telegramBotService = new TelegramBotService();
