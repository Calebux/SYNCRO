import * as Sentry from '@sentry/node';
import logger from '../config/logger';

const FAILURE_WINDOW_MS = 60 * 60 * 1000;
const ALERT_THRESHOLD = parseInt(process.env.WEBHOOK_SIGNATURE_ALERT_THRESHOLD || '5', 10);
const ALERT_COOLDOWN_MS = parseInt(process.env.WEBHOOK_SIGNATURE_ALERT_COOLDOWN_MS || '900000', 10);

interface ProviderFailureState {
  timestamps: number[];
  lastAlertAt: number | null;
}

/**
 * Tracks webhook signature verification failures per provider and emits
 * Sentry alerts when repeated failures suggest a spoofing attack.
 */
export class WebhookSignatureAlertService {
  private failures = new Map<string, ProviderFailureState>();

  recordFailure(provider: string, context: Record<string, unknown> = {}): void {
    const now = Date.now();
    const state = this.failures.get(provider) ?? { timestamps: [], lastAlertAt: null };

    state.timestamps.push(now);
    state.timestamps = state.timestamps.filter((ts) => now - ts < FAILURE_WINDOW_MS);
    this.failures.set(provider, state);

    logger.warn(`[${provider}] Webhook signature verification failed`, {
      failuresInWindow: state.timestamps.length,
      ...context,
    });

    if (
      state.timestamps.length >= ALERT_THRESHOLD &&
      (!state.lastAlertAt || now - state.lastAlertAt > ALERT_COOLDOWN_MS)
    ) {
      state.lastAlertAt = now;
      Sentry.captureMessage(`Repeated ${provider} webhook signature failures`, {
        level: 'warning',
        tags: { provider, alert_type: 'webhook_signature_failure' },
        extra: {
          failuresInWindow: state.timestamps.length,
          threshold: ALERT_THRESHOLD,
          ...context,
        },
      });
      logger.error(`[${provider}] ALERT: repeated signature failures detected`, {
        failuresInWindow: state.timestamps.length,
      });
    }
  }

  recordSuccess(provider: string): void {
    const state = this.failures.get(provider);
    if (state) {
      state.timestamps = [];
    }
  }

  getFailureCount(provider: string): number {
    const now = Date.now();
    const state = this.failures.get(provider);
    if (!state) return 0;
    return state.timestamps.filter((ts) => now - ts < FAILURE_WINDOW_MS).length;
  }
}

export const webhookSignatureAlertService = new WebhookSignatureAlertService();
