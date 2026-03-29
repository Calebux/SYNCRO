import webpush from 'web-push';
import logger from '../config/logger';
import { NotificationPayload, DeliveryResult } from '../types/reminder';
import { withRetry, RetryableError, NonRetryableError } from '../utils/retry';
import { sanitizeUrl } from '../utils/sanitize-url';

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
    this.vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
    this.vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
    this.vapidSubject = process.env.VAPID_SUBJECT || process.env.FRONTEND_URL || 'mailto:noreply@synchro.app';

    if (this.vapidPublicKey && this.vapidPrivateKey) {
      webpush.setVapidDetails(this.vapidSubject, this.vapidPublicKey, this.vapidPrivateKey);
      logger.info('Push service initialized with VAPID keys');
    } else {
      logger.warn('Push service VAPID keys not configured');
    }
  }

  /**
   * Send push notification with retry logic
   */
  async sendPushNotification(
    pushSubscription: PushSubscription,
    payload: NotificationPayload,
    options: { maxAttempts?: number } = {}
  ): Promise<DeliveryResult> {
    const { maxAttempts = 3 } = options;

    if (!this.vapidPublicKey || !this.vapidPrivateKey) {
      return {
        success: false,
        error: 'Push service not configured (missing VAPID keys)',
        metadata: { retryable: false },
      };
    }

    try {
      return await withRetry(
        async () => {
          const notificationPayload = JSON.stringify({
            title: payload.title,
            body: payload.body,
            icon: '/icon.svg',
            badge: '/icon.svg',
            data: {
              subscriptionId: payload.subscription.id,
              reminderType: payload.reminderType,
              renewalDate: payload.renewalDate,
              url: payload.subscription.renewal_url ? sanitizeUrl(payload.subscription.renewal_url) : '/dashboard',
            },
            requireInteraction: payload.reminderType === 'renewal' && payload.daysBefore <= 1,
          });

          await webpush.sendNotification(pushSubscription, notificationPayload);

          logger.info('Push notification sent successfully', {
            subscriptionId: payload.subscription.id,
          });

          return {
            success: true,
            metadata: {
              timestamp: new Date().toISOString(),
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

      logger.error('Failed to send push notification:', errorMessage);

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
    if (!this.vapidPublicKey || !this.vapidPrivateKey) {
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

      await webpush.sendNotification(pushSubscription, notificationPayload);

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

