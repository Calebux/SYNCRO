/**
 * @syncro/sdk
 *
 * Programmatic subscription management for the Syncro platform.
 *
 * Quick start:
 * ```ts
 * import { SyncroSDK, cancelSubscription } from '@syncro/sdk';
 *
 * // Option A – class-based (EventEmitter, reusable)
 * const sdk = new SyncroSDK({ baseUrl: 'https://api.syncro.app', apiKey: '<token>' });
 * sdk.on('cancellation:success', (s) => console.log('Cancelled!', s));
 * const result = await sdk.cancelSubscription({ subscriptionId: 'sub_abc123' });
 *
 * // Option B – standalone one-liner
 * const result = await cancelSubscription({
 *   subscriptionId: 'sub_abc123',
 *   baseUrl: 'https://api.syncro.app',
 *   apiKey: '<token>',
 *   cancellationUrl: 'https://netflix.com/cancel',
 *   reason: 'Too expensive',
 * });
 * ```
 */

export { SyncroSDK } from './client';
export type {
  SyncroSDKConfig,
  CancelSubscriptionOptions,
  CancellationStatus,
  BlockchainSyncInfo,
} from './types';

// ── Standalone helper ─────────────────────────────────────────────────────────

import { SyncroSDK } from './client';
import type { CancellationStatus } from './types';

/**
 * One-shot `cancelSubscription()` helper — no class instantiation required.
 *
 * Identical to `new SyncroSDK(config).cancelSubscription(options)` but
 * without maintaining state between calls. Prefer the `SyncroSDK` class
 * when you need to listen for events or manage multiple operations.
 *
 * @param options - subscriptionId (required), plus optional cancellationUrl,
 *                  reason, baseUrl, and apiKey.
 */
export async function cancelSubscription(
  options: {
    subscriptionId: string;
    cancellationUrl?: string;
    reason?: string;
    /** Override the base URL (falls back to SYNCRO_BASE_URL env var). */
    baseUrl?: string;
    /** Override the API key (falls back to SYNCRO_API_KEY env var). */
    apiKey?: string;
  }
): Promise<CancellationStatus> {
  const baseUrl =
    options.baseUrl ?? process.env['SYNCRO_BASE_URL'] ?? '';
  const apiKey =
    options.apiKey ?? process.env['SYNCRO_API_KEY'] ?? '';

  const sdk = new SyncroSDK({ baseUrl, apiKey });

  return sdk.cancelSubscription({
    subscriptionId: options.subscriptionId,
    cancellationUrl: options.cancellationUrl,
    reason: options.reason,
  });
}
