/**
 * @syncro/sdk – Type definitions for the cancelSubscription() helper.
 *
 * These types mirror the backend CancellationInput / CancellationResult
 * interfaces so SDK consumers get full TypeScript support without depending
 * on the backend package directly.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

export interface SyncroSDKConfig {
  /** Base URL of the Syncro backend (e.g. "https://api.syncro.app"). */
  baseUrl: string;
  /** API key or Bearer token used to authenticate requests. */
  apiKey: string;
}

// ── Input ────────────────────────────────────────────────────────────────────

export interface CancelSubscriptionOptions {
  /** UUID of the subscription to cancel. */
  subscriptionId: string;
  /**
   * Optional URL of the merchant's own cancellation page.
   * When present it is stored on-chain and returned in the result so the
   * caller can redirect the user (e.g. `window.location.href = result.cancellationUrl`).
   */
  cancellationUrl?: string;
  /** Human-readable reason (appended to the subscription's notes field). */
  reason?: string;
}

// ── Result ───────────────────────────────────────────────────────────────────

export interface BlockchainSyncInfo {
  /** true when the event was successfully written to both DB and chain. */
  synced: boolean;
  /** On-chain transaction hash, if the Soroban contract was reached. */
  transactionHash?: string;
  /** Chain-layer error message when synced is false. */
  error?: string;
}

export interface CancellationStatus {
  /** true = cancelled successfully (DB updated); false = operation failed. */
  success: boolean;
  /** UUID of the cancelled subscription. */
  subscriptionId: string;
  /** Current status field from the subscription record ("cancelled" on success). */
  status: string;
  /**
   * Merchant cancellation redirect URL (echoed back from the response so the
   * caller can open it immediately after cancellation).
   */
  cancellationUrl?: string;
  /** On-chain / DB logging result. */
  blockchain: BlockchainSyncInfo;
  /** Error message when success is false. */
  error?: string;
  /** Full subscription record as returned by the backend. */
  subscription?: Record<string, unknown>;
}
