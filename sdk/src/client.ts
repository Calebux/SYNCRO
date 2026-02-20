import { EventEmitter } from 'events';
import type {
  SyncroSDKConfig,
  CancelSubscriptionOptions,
  CancellationStatus,
} from './types';

/**
 * SyncroSDK – primary entry point for programmatic subscription management.
 *
 * Extends Node.js EventEmitter so callers can react to events:
 *
 * ```ts
 * const sdk = new SyncroSDK({ baseUrl, apiKey });
 *
 * sdk.on('cancellation:success', (status) => console.log('Cancelled', status));
 * sdk.on('cancellation:failure', (status) => console.error('Failed', status));
 *
 * const status = await sdk.cancelSubscription({
 *   subscriptionId: 'abc-123',
 *   cancellationUrl: 'https://netflix.com/cancel',
 *   reason: 'Too expensive',
 * });
 * ```
 */
export class SyncroSDK extends EventEmitter {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: SyncroSDKConfig) {
    super();

    if (!config.baseUrl) throw new Error('SyncroSDK: baseUrl is required');
    if (!config.apiKey) throw new Error('SyncroSDK: apiKey is required');

    // Strip trailing slash for consistent URL construction
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Cancel a subscription.
   *
   * - POSTs to `POST /api/subscriptions/:id/cancel` on the Syncro backend.
   * - The backend marks the subscription as cancelled in the database and
   *   logs the cancellation on-chain (Soroban contract `cancel_sub`).
   * - Emits `cancellation:success` or `cancellation:failure` event so listeners
   *   can react without polling the return value.
   * - Optionally provides a `cancellationUrl` redirect link to the merchant's
   *   own cancellation page (returned in `CancellationStatus.cancellationUrl`).
   *
   * @param options - Required `subscriptionId`; optional `cancellationUrl`, `reason`.
   * @returns       A typed `CancellationStatus` describing the outcome.
   *
   * @example
   * ```ts
   * const result = await sdk.cancelSubscription({
   *   subscriptionId: 'sub_abc123',
   *   cancellationUrl: 'https://example.com/manage',
   *   reason: 'Not using the service anymore',
   * });
   *
   * if (result.success && result.cancellationUrl) {
   *   window.location.href = result.cancellationUrl; // redirect to merchant
   * }
   * ```
   */
  async cancelSubscription(
    options: CancelSubscriptionOptions
  ): Promise<CancellationStatus> {
    const { subscriptionId, cancellationUrl, reason } = options;

    if (!subscriptionId) {
      const status: CancellationStatus = {
        success: false,
        subscriptionId: '',
        status: 'unknown',
        blockchain: { synced: false },
        error: 'subscriptionId is required',
      };
      this.emit('cancellation:failure', status);
      return status;
    }

    const url = `${this.baseUrl}/api/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          ...(cancellationUrl && { cancellation_url: cancellationUrl }),
          ...(reason && { reason }),
        }),
      });

      const json = await response.json() as Record<string, any>;

      if (!response.ok) {
        const status: CancellationStatus = {
          success: false,
          subscriptionId,
          status: json?.data?.status ?? 'unknown',
          blockchain: { synced: false },
          error: json?.error ?? `HTTP ${response.status}`,
          subscription: json?.data,
        };
        this.emit('cancellation:failure', status);
        return status;
      }

      const status: CancellationStatus = {
        success: true,
        subscriptionId,
        status: json?.data?.status ?? 'cancelled',
        cancellationUrl: json?.cancellationUrl ?? cancellationUrl,
        blockchain: {
          synced: json?.blockchain?.synced ?? false,
          transactionHash: json?.blockchain?.transactionHash,
          error: json?.blockchain?.error,
        },
        subscription: json?.data,
      };

      this.emit('cancellation:success', status);
      return status;
    } catch (networkError) {
      const error =
        networkError instanceof Error ? networkError.message : String(networkError);

      const status: CancellationStatus = {
        success: false,
        subscriptionId,
        status: 'unknown',
        blockchain: { synced: false },
        error: `Network error: ${error}`,
      };
      this.emit('cancellation:failure', status);
      return status;
    }
  }
}
