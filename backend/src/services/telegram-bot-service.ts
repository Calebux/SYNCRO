import logger from '../config/logger';
import { env } from '../config/env';
import { DeliveryResult } from '../types/reminder';
import { V3NotificationEventType, V3EventPayload } from '../types/v3-notifications';
import { renderV3Telegram } from './v3-notification-templates';
import { ExternalServiceClient } from '../utils/external-service-client';
import { withRetry, NonRetryableError } from '../utils/retry';

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
      const { supabase } = await import('../config/database');

      const { data, error } = await supabase
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
   * Deprecated stub — subscription reminders removed in v3.
   */
  async sendRenewalReminder(): Promise<DeliveryResult> {
    logger.warn('[TelegramBotService] sendRenewalReminder deprecated — subscription reminders removed in v3. Use sendV3Notification.');
    return {
      success: false,
      error: 'Subscription reminder templates have been removed in v3. Use V3 notification dispatch.',
      metadata: { retryable: false, deprecated: true },
    };
  }

  /**
   * Send a V3 notification via Telegram using renderV3Telegram template.
   */
  async sendV3Notification(
    userId: string,
    eventType: V3NotificationEventType,
    payload: V3EventPayload,
    chatId?: string,
    options: { maxAttempts?: number } = {},
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
          const message = renderV3Telegram(eventType, payload);
          const result = await this.sendMessage(targetChatId, message, {
            parseMode: 'HTML',
            maxAttempts: 1,
          });

          logger.info('[TelegramBotService] V3 notification sent', {
            userId,
            eventType,
            messageId: result.message_id,
          });

          return {
            success: true,
            metadata: {
              eventType,
              messageId: result.message_id,
              chatId: targetChatId,
            },
          };
        },
        { maxAttempts },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[TelegramBotService] Failed to send V3 notification', {
        userId,
        eventType,
        error: errorMessage,
      });
      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: this.isRetryableError(error) },
      };
    }
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
