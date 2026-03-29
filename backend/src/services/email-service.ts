import nodemailer from 'nodemailer';
import logger from '../config/logger';
import { NotificationPayload, DeliveryResult } from '../types/reminder';
import { withRetry, RetryableError, NonRetryableError } from '../utils/retry';
import { sanitizeUrl } from '../utils/sanitize-url';

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

  constructor(config?: EmailConfig) {
    this.fromEmail = config?.from || process.env.EMAIL_FROM || 'noreply@synchro.app';

    // Initialize transporter based on config
    if (config?.host) {
      // SMTP configuration
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port || 587,
        secure: config.secure || false,
        auth: config.auth,
      });
    } else if (process.env.SMTP_HOST) {
      // SMTP from environment variables
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASSWORD || '',
        },
      });
    } else {
      // Use SendGrid, Mailgun, or other service via API
      // For now, log that email service is not configured
      logger.warn('Email service not fully configured. Using mock transporter.');
      this.transporter = nodemailer.createTransport({
        jsonTransport: true, // Mock transport for development
      });
    }
  }

  /**
   * Verify email service connection
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
      return true;
    } catch (error) {
      logger.error('Email service connection failed:', error);
      return false;
    }
  }

  /**
   * Send renewal reminder email with retry logic
   */
  async sendReminderEmail(
    recipientEmail: string,
    payload: NotificationPayload,
    options: { maxAttempts?: number } = {}
  ): Promise<DeliveryResult> {
    const { maxAttempts = 3 } = options;

    try {
      return await withRetry(
        async () => {
          const subject = this.getEmailSubject(payload);
          const html = this.getEmailTemplate(payload);

          if (!this.transporter) {
            throw new NonRetryableError('Email transporter not configured');
          }

          const info = await this.transporter.sendMail({
            from: this.fromEmail,
            to: recipientEmail,
            subject,
            html,
            text: this.getEmailText(payload),
          });

          logger.info(`Email sent successfully to ${recipientEmail}`, {
            messageId: info.messageId,
          });

          return {
            success: true,
            metadata: {
              messageId: info.messageId,
              accepted: info.accepted,
              rejected: info.rejected,
            },
          };
        },
        { maxAttempts }
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      
      // Determine if error is retryable
      const isRetryable = this.isRetryableError(error);

      logger.error(`Failed to send email to ${recipientEmail}:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
        metadata: {
          retryable: isRetryable,
        },
      };
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof NonRetryableError) {
      return false;
    }

    if (error instanceof RetryableError) {
      return true;
    }

    // Network errors and timeouts are retryable
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

  /**
   * Generate email subject
   */
  private getEmailSubject(payload: NotificationPayload): string {
    const { subscription, daysBefore, reminderType } = payload;

    if (reminderType === 'trial_expiry') {
      if (daysBefore === 0) {
        return `⚠️ Your ${subscription.name} trial ends TODAY — don't get charged!`;
      }
      return `⚠️ Your ${subscription.name} trial ends in ${daysBefore} day${daysBefore > 1 ? 's' : ''} — don't get charged!`;
    }

    if (reminderType === 'renewal') {
      if (daysBefore === 0) {
        return `⚠️ ${subscription.name} renews today`;
      }
      return `📅 ${subscription.name} renews in ${daysBefore} day${daysBefore > 1 ? 's' : ''}`;
    }

    return `🔔 ${subscription.name} reminder`;
  }

  /**
   * Generate email HTML template
   */
  private getEmailTemplate(payload: NotificationPayload): string {
      if (payload.reminderType === 'trial_expiry') {
        return this.getTrialEmailTemplate(payload);
      }
      return this.getRenewalEmailTemplate(payload);
    }

    private getTrialEmailTemplate(payload: NotificationPayload): string {
      const { subscription, daysBefore, renewalDate } = payload;
      const expiryFormatted = new Date(renewalDate).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      const chargeDate = new Date(renewalDate);
      chargeDate.setDate(chargeDate.getDate() + 1);
      const chargeDateFormatted = chargeDate.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      const convertPrice = subscription.trial_converts_to_price ?? subscription.price;
      const urgencyColor = daysBefore <= 1 ? '#E86A33' : daysBefore <= 3 ? '#FFD166' : '#667eea';
      const cancelUrl = subscription.renewal_url ? sanitizeUrl(subscription.renewal_url) : '#';
      const dayLabel = daysBefore === 0 ? 'TODAY at midnight' : `in ${daysBefore} day${daysBefore > 1 ? 's' : ''}`;

      return `<!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Trial Ending Soon</title></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,${urgencyColor} 0%,#764ba2 100%);padding:30px;border-radius:10px 10px 0 0;text-align:center;">
      <h1 style="color:white;margin:0;font-size:24px;">⚠️ Your ${subscription.name} trial ends ${dayLabel}</h1>
    </div>
    <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
      <div style="background:white;padding:20px;border-radius:8px;margin:0 0 20px 0;border-left:4px solid ${urgencyColor};">
        <p style="margin:0 0 8px 0;"><strong>Service:</strong> ${subscription.name}</p>
        <p style="margin:0 0 8px 0;"><strong>FREE trial expires:</strong> ${expiryFormatted}</p>
        ${subscription.credit_card_required
          ? `<p style="margin:0;color:#E86A33;"><strong>If you don't cancel:</strong> You'll be charged <strong>$${convertPrice.toFixed(2)}/${subscription.billing_cycle}</strong> starting ${chargeDateFormatted}.</p>`
          : `<p style="margin:0;color:#007A5C;"><strong>No credit card on file</strong> — your access will simply end if you don't upgrade.</p>`}
      </div>
      <div style="text-align:center;margin:24px 0;">
        <a href="${cancelUrl}" style="background:#E86A33;color:white;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:700;font-size:15px;display:inline-block;margin:4px;">Cancel Trial Now →</a>
        <a href="${cancelUrl}" style="background:#007A5C;color:white;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:700;font-size:15px;display:inline-block;margin:4px;">Keep My Subscription →</a>
      </div>
      <p style="color:#666;font-size:13px;margin-top:20px;text-align:center;">This reminder is from SYNCRO — your subscription manager. We're helping you avoid unexpected charges.</p>
    </div>
  </body>
  </html>`.trim();
    }

    private getRenewalEmailTemplate(payload: NotificationPayload): string {
      const { subscription, daysBefore, renewalDate } = payload;
      const renewalDateFormatted = new Date(renewalDate).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

      return `<!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Subscription Reminder</title></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:30px;border-radius:10px 10px 0 0;text-align:center;">
      <h1 style="color:white;margin:0;font-size:28px;">Subscription Reminder</h1>
    </div>
    <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px;">
      <div style="background:white;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #667eea;">
        <p style="margin:0 0 10px 0;"><strong>Service:</strong> ${subscription.name}</p>
        <p style="margin:0 0 10px 0;"><strong>Category:</strong> ${subscription.category}</p>
        <p style="margin:0 0 10px 0;"><strong>Price:</strong> $${subscription.price.toFixed(2)}/${subscription.billing_cycle}</p>
        <p style="margin:0 0 10px 0;"><strong>Renewal Date:</strong> ${renewalDateFormatted}</p>
        ${daysBefore > 0 ? `<p style="margin:0;"><strong>Days Remaining:</strong> ${daysBefore}</p>` : ''}
      </div>
      ${subscription.renewal_url ? `<div style="text-align:center;margin:30px 0;"><a href="${sanitizeUrl(subscription.renewal_url)}" style="background:#667eea;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Manage Subscription</a></div>` : ''}
      <p style="color:#666;font-size:14px;margin-top:30px;">This is an automated reminder from Synchro.</p>
    </div>
  </body>
  </html>`.trim();
    }


  /**
   * Generate plain text email
   */
  private getEmailText(payload: NotificationPayload): string {
    const { subscription, daysBefore, renewalDate } = payload;
    const renewalDateFormatted = new Date(renewalDate).toLocaleDateString(
      'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' }
    );

    return `
Subscription Reminder

${subscription.name} renews in ${daysBefore} day${daysBefore > 1 ? 's' : ''}

Service: ${subscription.name}
Category: ${subscription.category}
Price: $${subscription.price.toFixed(2)}/${subscription.billing_cycle}
Renewal Date: ${renewalDateFormatted}
${daysBefore > 0 ? `Days Remaining: ${daysBefore}` : ''}

${subscription.renewal_url ? `Manage Subscription: ${sanitizeUrl(subscription.renewal_url)}` : ''}

This is an automated reminder from Synchro.
    `.trim();
  }

  /**
   * Send a simple plain-text / HTML email.
   * Returns a resolved promise on success; rejects on failure.
   */
  async sendSimpleEmail(to: string, subject: string, text: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email transporter not configured');
    }
    await this.transporter.sendMail({
      from: this.fromEmail,
      to,
      subject,
      text,
      html: `<p>${text}</p>`,
    });
    logger.info(`Simple email sent to ${to}`, { subject });
  }

  /**
   * Send a team invitation email
   */
  async sendInvitationEmail(
    recipientEmail: string,
    payload: { inviterEmail: string; teamName: string; role: string; acceptUrl: string; expiresAt: Date }
  ): Promise<DeliveryResult> {
    try {
      return await withRetry(async () => {
        if (!this.transporter) {
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

        const info = await this.transporter.sendMail({
          from: this.fromEmail,
          to: recipientEmail,
          subject,
          html,
          text,
        });

        logger.info(`Invitation email sent to ${recipientEmail}`, { messageId: info.messageId });

        return {
          success: true,
          metadata: { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected },
        };
      }, { maxAttempts: 3 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send invitation email to ${recipientEmail}:`, errorMessage);
      return { success: false, error: errorMessage, metadata: { retryable: this.isRetryableError(error) } };
    }
  }
  /**
   * Send risk alert email
   */
  async sendRiskAlert(payload: {
    to: string;
    subscriptionName: string;
    riskFactors: any[];
    renewalDate: string;
    recommendedAction: string;
  }): Promise<DeliveryResult> {
    try {
      return await withRetry(async () => {
        if (!this.transporter) {
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
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" style="background: #e53e3e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
        Review Subscription
      </a>
    </div>
  </div>
</body>
</html>`.trim();


        const text = `Risk Alert: ${payload.subscriptionName} renewal at risk\n\nFactors:\n${factorsText}\n\nRecommendation: ${payload.recommendedAction}`;

        const info = await this.transporter.sendMail({
          from: this.fromEmail,
          to: payload.to,
          subject,
          html,
          text,
        });

        logger.info(`Risk alert email sent to ${payload.to}`, { messageId: info.messageId });

        return {
          success: true,
          metadata: { messageId: info.messageId },
        };
      }, { maxAttempts: 3 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send risk alert email to ${payload.to}:`, errorMessage);
      return { success: false, error: errorMessage, metadata: { retryable: this.isRetryableError(error) } };
    }
  }

  /**
   * Helper to get human-readable factor description
   */
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

