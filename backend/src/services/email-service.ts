import nodemailer from 'nodemailer';
import logger from '../config/logger';
import { env } from '../config/env';
import { DeliveryResult } from '../types/reminder';
import { withRetry, RetryableError, NonRetryableError } from '../utils/retry';
import { complianceService } from './compliance-service';
import { EXTERNAL_SERVICE_POLICIES } from '../config/external-services';
import {
  V3NotificationEventType,
  V3EventPayload,
} from '../types/v3-notifications';
import { renderV3Notification } from './v3-notification-templates';

export interface EmailConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from: string;
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private fromEmail: string;
  private policy = EXTERNAL_SERVICE_POLICIES.gmail;

  constructor(config?: EmailConfig) {
    this.fromEmail = config?.from || env.EMAIL_FROM || 'noreply@synchro.app';

    if (config?.host) {
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port || 587,
        secure: config.secure || false,
        auth: config.auth,
      });
    }
  }

  private async getTransporter(): Promise<nodemailer.Transporter> {
    if (this.transporter) {
      return this.transporter;
    }

    // SMTP belongs to the retired subscription domain. v3 notification
    // delivery uses in-app, push, Telegram, and Slack transports instead.
    logger.warn('SMTP email delivery is disabled in v3. Using mock transporter.');
    this.transporter = nodemailer.createTransport({ jsonTransport: true });

    return this.transporter;
  }

  async verifyConnection(): Promise<boolean> {
    const transporter = await this.getTransporter();
    if (!transporter) {
      return false;
    }

    try {
      await transporter.verify();
      logger.info('Email service connection verified');
      return true;
    } catch (error) {
      logger.error('Email service connection failed:', error);
      return false;
    }
  }

  private getUnsubscribeFooter(userId: string, emailType: string): string {
    const appUrl = env.FRONTEND_URL;
    const apiUrl = env.BACKEND_URL;
    const token = complianceService.generateUnsubscribeToken(userId, emailType);
    const unsubscribeUrl = `${apiUrl}/api/compliance/unsubscribe?token=${token}`;
    const preferencesUrl = `${appUrl}/email-preferences?token=${token}`;

    return `
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #9ca3af;">
      <p>You're receiving this because you have ${emailType} enabled in your Synchro account.</p>
      <p>
        <a href="${unsubscribeUrl}" style="color: #6366f1;">Unsubscribe from ${emailType}</a>
        &nbsp;|&nbsp;
        <a href="${preferencesUrl}" style="color: #6366f1;">Manage email preferences</a>
      </p>
    </div>
  `;
  }

  private getUnsubscribeHeaders(userId: string, emailType: string): Record<string, string> {
    const apiUrl = env.BACKEND_URL;
    const token = complianceService.generateUnsubscribeToken(userId, emailType);
    const unsubscribeUrl = `${apiUrl}/api/compliance/unsubscribe?token=${token}`;

    return {
      'List-Unsubscribe': `<mailto:unsubscribe@syncro.app>, <${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof NonRetryableError) {
      return false;
    }

    if (error instanceof RetryableError) {
      return true;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /econnrefused/i,
      /etimedout/i,
      /temporary/i,
      /rate limit/i,
      /503/i,
      /502/i,
      /504/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(errorMessage));
  }

  async sendV3Notification(
    recipientEmail: string,
    eventType: V3NotificationEventType,
    payload: V3EventPayload,
    options: { userId?: string; maxAttempts?: number } = {},
  ): Promise<DeliveryResult> {
    const maxAttempts = options.maxAttempts ?? this.policy.retryPolicy.maxAttempts;
    const { userId = '' } = options;

    try {
      return await withRetry(
        async () => {
          const rendered = renderV3Notification(eventType, payload);
          const transporter = await this.getTransporter();
          if (!transporter) {
            throw new NonRetryableError('Email transporter not configured');
          }

          const emailType = 'notifications';
          const unsubscribeFooter = userId ? this.getUnsubscribeFooter(userId, emailType) : '';
          const unsubscribeHeaders = userId ? this.getUnsubscribeHeaders(userId, emailType) : {};

          const info = await transporter.sendMail({
            from: this.fromEmail,
            to: recipientEmail,
            subject: rendered.title,
            html: (rendered.html ?? `<p>${rendered.body}</p>`) + unsubscribeFooter,
            text: rendered.body,
            headers: unsubscribeHeaders,
          });

          logger.info('[EmailService] V3 notification email sent', {
            eventType,
            messageId: info.messageId,
          });

          return {
            success: true,
            metadata: {
              eventType,
              messageId: info.messageId,
              accepted: info.accepted,
              rejected: info.rejected,
            },
          };
        },
        {
          ...this.policy.retryPolicy,
          maxAttempts,
        },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isRetryable = this.isRetryableError(error);
      logger.error('[EmailService] Failed to send V3 notification email', { eventType, errorMessage });
      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: isRetryable },
      };
    }
  }

  async sendReminderEmail(): Promise<DeliveryResult> {
    logger.warn('[EmailService] sendReminderEmail deprecated — subscription reminders removed in v3. Use sendV3Notification.');
    return {
      success: false,
      error: 'Subscription reminder templates have been removed in v3. Use V3 notification dispatch.',
      metadata: { retryable: false, deprecated: true },
    };
  }

  async sendSimpleEmail(
    to: string,
    subject: string,
    text: string,
    options?: { userId?: string; emailType?: string; html?: string },
  ): Promise<void> {
    const transporter = await this.getTransporter();
    if (!transporter) {
      throw new Error('Email transporter not configured');
    }
    const userId = options?.userId || '';
    const emailType = options?.emailType || 'notifications';
    const unsubscribeFooter = userId ? this.getUnsubscribeFooter(userId, emailType) : '';
    const unsubscribeHeaders = userId ? this.getUnsubscribeHeaders(userId, emailType) : {};

    await transporter.sendMail({
      from: this.fromEmail,
      to,
      subject,
      text,
      html: (options?.html ?? `<p>${text}</p>`) + unsubscribeFooter,
      headers: unsubscribeHeaders,
    });
    logger.info('Simple email sent', { subject });
  }

  async sendInvitationEmail(
    recipientEmail: string,
    payload: { inviterEmail: string; teamName: string; role: string; acceptUrl: string; expiresAt: Date },
  ): Promise<DeliveryResult> {
    try {
      return await withRetry(async () => {
        const transporter = await this.getTransporter();
        if (!transporter) {
          throw new NonRetryableError('Email transporter not configured');
        }

        const subject = `You've been invited to join ${payload.teamName} on Synchro`;
        const expiresFormatted = payload.expiresAt.toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric',
        });

        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Team Invitation</h1>
  </div>
  <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
    <p><strong>${payload.inviterEmail}</strong> has invited you to join <strong>${payload.teamName}</strong> on Synchro as a <strong>${payload.role}</strong>.</p>
    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
      <p style="margin: 0 0 8px 0;"><strong>Team:</strong> ${payload.teamName}</p>
      <p style="margin: 0 0 8px 0;"><strong>Role:</strong> ${payload.role}</p>
      <p style="margin: 0;"><strong>Expires:</strong> ${expiresFormatted}</p>
    </div>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${payload.acceptUrl}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
        Accept Invitation
      </a>
    </div>
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      This invitation expires on ${expiresFormatted}. If you did not expect this invitation, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`.trim();

        const text = `${payload.inviterEmail} has invited you to join ${payload.teamName} on Synchro as a ${payload.role}.\n\nAccept invitation: ${payload.acceptUrl}\n\nThis invitation expires on ${expiresFormatted}.`;

        const info = await transporter.sendMail({
          from: this.fromEmail,
          to: recipientEmail,
          subject,
          html,
          text,
        });

        logger.info('Invitation email sent', { messageId: info.messageId });
        return {
          success: true,
          metadata: { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected },
        };
      }, { maxAttempts: 3 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to send invitation email', { errorMessage });
      return { success: false, error: errorMessage, metadata: { retryable: this.isRetryableError(error) } };
    }
  }

  async sendRiskAlert(payload: {
    to: string;
    subscriptionName: string;
    riskFactors: any[];
    renewalDate: string;
    recommendedAction: string;
  }): Promise<DeliveryResult> {
    try {
      return await withRetry(async () => {
        const transporter = await this.getTransporter();
        if (!transporter) {
          throw new NonRetryableError('Email transporter not configured');
        }

        const subject = `⚠️ ${payload.subscriptionName} renewal at risk`;
        const factorsText = payload.riskFactors.map(f => `- ${this.getFactorDescription(f)}`).join('\n');

        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Risk Alert</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #e53e3e; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Risk Alert</h1>
  </div>
  <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
    <h2 style="color: #c53030;">${payload.subscriptionName} renewal at risk</h2>
    <p>We've detected that your subscription for <strong>${payload.subscriptionName}</strong> may fail to renew soon.</p>
    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #e53e3e;">
      <p><strong>Risk Factors:</strong></p>
      <ul>
        ${payload.riskFactors.map(f => `<li>${this.getFactorDescription(f)}</li>`).join('')}
      </ul>
      <p><strong>Recommendation:</strong> ${payload.recommendedAction}</p>
    </div>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${env.FRONTEND_URL}/dashboard" style="background: #e53e3e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
        Review Subscription
      </a>
    </div>
  </div>
</body>
</html>`.trim();

        const text = `Risk Alert: ${payload.subscriptionName} renewal at risk\n\nFactors:\n${factorsText}\n\nRecommendation: ${payload.recommendedAction}`;

        const info = await transporter.sendMail({
          from: this.fromEmail,
          to: payload.to,
          subject,
          html,
          text,
        });

        logger.info('Risk alert email sent', { messageId: info.messageId });
        return {
          success: true,
          metadata: { messageId: info.messageId },
        };
      }, { maxAttempts: 3 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to send risk alert email', { errorMessage });
      return { success: false, error: errorMessage, metadata: { retryable: this.isRetryableError(error) } };
    }
  }

  private getFactorDescription(factor: any): string {
    switch (factor.factor_type) {
      case 'consecutive_failures':
        return `${factor.details?.count || 0} consecutive payment failures detected`;
      case 'balance_projection':
        return 'Projected account balance is insufficient for next renewal';
      case 'approval_expiration':
        return `Payment approval expires on ${new Date(factor.details?.expires_at).toLocaleDateString()}`;
      default:
        return String(factor.factor_type).replace(/_/g, ' ');
    }
  }
}

export const emailService = new EmailService();
