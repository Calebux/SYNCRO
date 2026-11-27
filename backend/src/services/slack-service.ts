import logger from '../config/logger';
import { env } from '../config/env';
import { DeliveryResult } from '../types/reminder';
import { V3NotificationEventType, V3EventPayload } from '../types/v3-notifications';
import { renderV3Slack } from './v3-notification-templates';
import { ExternalServiceClient } from '../utils/external-service-client';

export interface SlackServiceStatus {
  configured: boolean;
  webhookUrlConfigured: boolean;
  webhookHost: string | null;
}

export class SlackService {
  private readonly webhookUrl: string;
  private readonly client = new ExternalServiceClient('slack');

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl || env.SLACK_WEBHOOK_URL || '';
  }

  isConfigured(): boolean {
    return Boolean(this.webhookUrl);
  }

  getStatus(): SlackServiceStatus {
    let webhookHost: string | null = null;

    if (this.webhookUrl) {
      try {
        webhookHost = new URL(this.webhookUrl).host;
      } catch {
        webhookHost = null;
      }
    }

    return {
      configured: this.isConfigured(),
      webhookUrlConfigured: this.isConfigured(),
      webhookHost,
    };
  }

  /**
   * Deprecated stub — subscription reminders removed in v3.
   */
  async sendReminderNotification(): Promise<DeliveryResult> {
    logger.warn('[SlackService] sendReminderNotification deprecated — subscription reminders removed in v3. Use sendV3Notification.');
    return {
      success: false,
      error: 'Subscription reminder templates have been removed in v3. Use V3 notification dispatch.',
      metadata: { retryable: false, deprecated: true },
    };
  }

  /**
   * Send a V3 notification via Slack using renderV3Slack template blocks.
   */
  async sendV3Notification(
    eventType: V3NotificationEventType,
    payload: V3EventPayload,
    webhookUrl?: string,
    options: { maxAttempts?: number } = {},
  ): Promise<DeliveryResult> {
    const targetUrl = webhookUrl || this.webhookUrl;
    const { maxAttempts = 3 } = options;

    if (!targetUrl) {
      return {
        success: false,
        error: 'Slack webhook URL is not configured',
        metadata: { retryable: false },
      };
    }

    try {
      const slackMsg = renderV3Slack(eventType, payload);
      await this.client.request(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackMsg),
        maxAttempts,
      });

      logger.info('[SlackService] V3 notification sent successfully', { eventType });
      return {
        success: true,
        metadata: { channel: 'slack', eventType },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[SlackService] Failed to send V3 notification:', { eventType, errorMessage });
      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: true },
      };
    }
  }

  async sendCustomMessage(
    text: string,
    options: { maxAttempts?: number } = {},
  ): Promise<DeliveryResult> {
    if (!this.webhookUrl) {
      return {
        success: false,
        error: 'Slack webhook URL is not configured',
        metadata: { retryable: false },
      };
    }

    try {
      await this.client.request(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      return {
        success: true,
        metadata: { channel: 'slack' },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: true },
      };
    }
  }


}

export const slackService = new SlackService();

export async function sendSlackAlert(webhookUrl: string, text: string): Promise<void> {
  const service = new SlackService(webhookUrl);
  const result = await service.sendCustomMessage(text, { maxAttempts: 1 });

  if (!result.success) {
    logger.warn('Slack webhook returned a non-success result', {
      error: result.error,
      retryable: result.metadata?.retryable,
    });
  }
}
