import logger from '../config/logger';
import { env } from '../config/env';
import { NotificationPayload, DeliveryResult } from '../types/reminder';
import { sanitizeUrl } from '../utils/sanitize-url';
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

  async sendReminderNotification(
    payload: NotificationPayload,
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
        body: JSON.stringify(this.buildMessage(payload)),
      });

      logger.info('Slack notification sent successfully', {
        subscriptionId: payload.subscription.id,
        reminderType: payload.reminderType,
      });

      return {
        success: true,
        metadata: {
          channel: 'slack',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to send Slack notification:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: true }, // ExternalServiceClient handles retries, so we assume failure after retries
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

  private buildMessage(payload: NotificationPayload): { text: string; blocks: Array<Record<string, unknown>> } {
    const subscriptionUrl = payload.subscription.renewal_url
      ? sanitizeUrl(payload.subscription.renewal_url)
      : null;

    const summary = this.buildSummary(payload);
    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: summary.title,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: summary.body,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Subscription:*\n${payload.subscription.name}` },
          { type: 'mrkdwn', text: `*Due in:*\n${payload.daysBefore} day${payload.daysBefore === 1 ? '' : 's'}` },
          { type: 'mrkdwn', text: `*Renewal date:*\n${new Date(payload.renewalDate).toLocaleDateString('en-US')}` },
          { type: 'mrkdwn', text: `*Channel:*\nSlack` },
        ],
      },
    ];

    if (subscriptionUrl && subscriptionUrl !== '#') {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open subscription' },
            url: subscriptionUrl,
          },
        ],
      });
    }

    return {
      text: `${summary.title} ${summary.body}`,
      blocks,
    };
  }

  private buildSummary(payload: NotificationPayload): { title: string; body: string } {
    if (payload.reminderType === 'trial_expiry') {
      return {
        title: `Trial ending soon: ${payload.subscription.name}`,
        body: `${payload.subscription.name} trial ends in ${payload.daysBefore} day${payload.daysBefore === 1 ? '' : 's'}.`,
      };
    }

    return {
      title: `Renewal reminder: ${payload.subscription.name}`,
      body: `${payload.subscription.name} renews in ${payload.daysBefore} day${payload.daysBefore === 1 ? '' : 's'}.`,
    };
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
