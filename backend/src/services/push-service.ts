import webpush from 'web-push';
import logger from '../config/logger';
import { env } from '../config/env';
import { NotificationPayload, DeliveryResult } from '../types/reminder';
import { withRetry, RetryableError, NonRetryableError } from '../utils/retry';
import { sanitizeUrl } from '../utils/sanitize-url';
import { secretProvider } from './secret-provider';

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export class PushService {
  private vapidPublicKey: string;
  private vapidPrivateKey: string;
  private vapidSubject: string;

  constructor() {
    this.vapidPublicKey = env.VAPID_PUBLIC_KEY || '';
    this.vapidPrivateKey = ''; // Will be fetched from secretProvider
    this.vapidSubject = env.VAPID_SUBJECT || env.FRONTEND_URL || 'mailto:noreply@synchro.app';

    if (this.vapidPublicKey) {
      logger.info('Push service initialized with public key');
    } else {
      logger.warn('Push service VAPID public key not configured');
    }
  }

  private async getVapidDetails() {
    const privateKey = await secretProvider.getSecret('VAPID_PRIVATE_KEY');
    if (!privateKey) {
      throw new Error('VAPID_PRIVATE_KEY not configured');
    }
    return {
      subject: this.vapidSubject,
      publicKey: this.vapidPublicKey,
      privateKey: privateKey,
    };
  }

  /**
   * Deprecated stub — subscription reminders removed in v3. Use send().
   */
  async sendPushNotification(): Promise<DeliveryResult> {
    logger.warn('[PushService] sendPushNotification deprecated — subscription reminders removed in v3. Use send() with V3 render output.');
    return {
      success: false,
      error: 'Subscription reminder templates have been removed in v3. Use send() via V3 notification dispatch.',
      metadata: { retryable: false, deprecated: true },
    };
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

    // Check for specific web-push error codes
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const statusCode = (error as any).statusCode;
      
      // 410 (Gone) and 404 (Not Found) are not retryable (subscription invalid)
      if (statusCode === 410 || statusCode === 404) {
        return false;
      }

      // 429 (Too Many Requests) and 5xx errors are retryable
      if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
        return true;
      }
    }

    // Network errors are retryable
    const errorMessage = error instanceof Error ? error.message : String(error);
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /econnrefused/i,
      /etimedout/i,
      /temporary/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(errorMessage));
  }

  /**
   * Get VAPID public key (for frontend)
   */
  getVapidPublicKey(): string {
    return this.vapidPublicKey;
  }
  /**
   * Generic send method for custom notifications
   */
  async send(
    pushSubscription: PushSubscription,
    payload: { title: string; body: string; url?: string }
  ): Promise<DeliveryResult> {
    const vapidDetails = await this.getVapidDetails().catch(() => null);
    if (!vapidDetails || !vapidDetails.publicKey || !vapidDetails.privateKey) {
      return {
        success: false,
        error: 'Push service not configured',
        metadata: { retryable: false },
      };
    }

    try {
      const notificationPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: '/icon.svg',
        badge: '/icon.svg',
        data: {
          url: payload.url || '/dashboard',
        },
      });

      await webpush.sendNotification(pushSubscription, notificationPayload, {
        vapidDetails,
      });

      return {
        success: true,
        metadata: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
        metadata: { retryable: this.isRetryableError(error) },
      };
    }
  }
}

export const pushService = new PushService();

