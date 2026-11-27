/**
 * Provider-agnostic payment contract (Phase 1 — Foundation)
 *
 * This interface defines the domain operations that every payment provider
 * (Stripe, PayPal, Paystack) must eventually implement. It describes DOMAIN
 * behavior rather than provider-specific APIs.
 *
 * This is the foundation for future adapter implementations. The existing
 * provider code has not yet been migrated to conform to this interface.
 *
 * Related: Issue #1282 — Payment provider abstraction
 * Epic: E — Backend domain rewrites (SYNCRO v2)
 */

import type { PaymentState, PaymentEvent, PaymentTransition } from './payment-state';

/**
 * Amount specification for payment operations.
 * All providers must support amount and currency; fractional amounts
 * are handled in the provider's smallest unit (cents, kobo, etc.).
 */
export interface PaymentAmount {
  /** Amount in the currency's smallest unit (e.g., cents for USD, kobo for NGN) */
  value: number;
  /** ISO 4217 currency code (e.g., 'USD', 'NGN', 'EUR') */
  currency: string;
}

/**
 * Result of creating a payment intent.
 * Some providers require user action (e.g., 3DS, PayPal approval),
 * others authorize immediately.
 */
export interface CreateIntentResult {
  /** Provider's identifier for this payment intent */
  intentId: string;
  /** Current payment state */
  state: PaymentState;
  /**
   * URL for user to complete payment (3DS, PayPal approval flow, etc.)
   * Null if no user action required
   */
  clientActionUrl: string | null;
  /** Provider-specific metadata (stored but not interpreted by domain logic) */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Parameters for creating a payment intent.
 */
export interface CreateIntentParams {
  amount: PaymentAmount;
  /** Idempotency key to prevent duplicate charges */
  idempotencyKey: string;
  /** Application-level metadata (user ID, subscription ID, etc.) */
  metadata?: Record<string, unknown>;
  /**
   * Return URL after user completes required actions.
   * Required for providers with approval flows (PayPal, 3DS)
   */
  returnUrl?: string;
  /**
   * Cancel URL if user abandons the flow.
   * Optional, used by providers with hosted checkout
   */
  cancelUrl?: string;
}

/**
 * Result of capturing a payment.
 */
export interface CaptureResult {
  /** Provider's transaction identifier */
  transactionId: string;
  /** New payment state after capture */
  state: PaymentState;
  /** Amount actually captured (may differ from intent if partial capture allowed) */
  capturedAmount: PaymentAmount;
  /** ISO 8601 timestamp of capture */
  capturedAt: string;
  /** Provider-specific metadata */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Optional parameters for capture operation.
 * Some providers support partial capture.
 */
export interface CaptureParams {
  /**
   * Amount to capture. If omitted, captures the full authorized amount.
   * Must not exceed the authorized amount.
   */
  amount?: PaymentAmount;
}

/**
 * Result of refunding a payment.
 */
export interface RefundResult {
  /** Provider's refund identifier */
  refundId: string;
  /** Updated payment state */
  state: PaymentState;
  /** Amount refunded */
  refundedAmount: PaymentAmount;
  /** ISO 8601 timestamp of refund */
  refundedAt: string;
  /**
   * Expected settlement date for the refund (provider-dependent).
   * Null if unknown or instant.
   */
  expectedSettlement: string | null;
  /** Provider-specific metadata */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Parameters for refunding a payment.
 */
export interface RefundParams {
  /**
   * Amount to refund. If omitted, refunds the full captured amount.
   * Must not exceed the captured amount minus any prior refunds.
   */
  amount?: PaymentAmount;
  /** Reason for the refund (for provider records and audit) */
  reason?: string;
  /** Idempotency key to prevent duplicate refunds */
  idempotencyKey: string;
}

/**
 * Payment status query result.
 */
export interface PaymentStatusResult {
  /** Provider's payment identifier */
  paymentId: string;
  /** Current payment state */
  state: PaymentState;
  /** Amount details */
  amount: PaymentAmount;
  /**
   * History of state transitions for this payment.
   * Most recent transition is last in the array.
   */
  transitions: PaymentTransition[];
  /** ISO 8601 timestamp of last status update */
  lastUpdatedAt: string;
  /** Provider-specific metadata */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Webhook verification result.
 * Already partially implemented in webhook-ingestion service;
 * included here for completeness of the provider contract.
 */
export interface WebhookVerification {
  /** Whether the webhook signature is valid */
  valid: boolean;
  /** Parsed event if valid, null otherwise */
  event: PaymentEvent | null;
  /** Error message if verification failed */
  error?: string;
}

/**
 * Provider-agnostic payment provider interface.
 *
 * Every payment provider adapter (Stripe, PayPal, Paystack) will eventually
 * implement this interface. This allows the application to treat all providers
 * uniformly at the domain layer.
 *
 * IMPORTANT: This is a foundational contract. Existing provider implementations
 * have NOT yet been migrated. Future work will:
 * 1. Implement StripeAdapter, PayPalAdapter, PaystackAdapter conforming to this interface
 * 2. Create a shared conformance test suite
 * 3. Migrate payment routes to be provider-agnostic
 *
 * @see payment-state.ts for state machine documentation
 * @see docs/payment-provider-contract.md for detailed documentation
 */
export interface PaymentProvider {
  /**
   * Provider identifier (e.g., 'stripe', 'paypal', 'paystack').
   * Used for routing and auditing, not for business logic branching.
   */
  readonly name: string;

  /**
   * Create a payment intent (authorization).
   *
   * This operation MAY require user action (3DS challenge, PayPal approval).
   * Check `CreateIntentResult.clientActionUrl` to determine if redirection is needed.
   *
   * State transition: none → pending → authorized (or failed)
   *
   * Idempotency: Multiple calls with the same idempotencyKey MUST return
   * the existing intent without creating a duplicate.
   *
   * @throws {PaymentProviderError} on provider API errors
   */
  createIntent(params: CreateIntentParams): Promise<CreateIntentResult>;

  /**
   * Capture a previously authorized payment.
   *
   * This finalizes the payment and triggers fund movement. Some providers
   * support partial capture; if amount is omitted, captures the full authorized amount.
   *
   * State transition: authorized → captured (or failed)
   *
   * @param intentId - Provider's payment intent identifier
   * @param params - Optional capture parameters (e.g., partial amount)
   * @throws {PaymentProviderError} if intent does not exist or is not in authorized state
   */
  capture(intentId: string, params?: CaptureParams): Promise<CaptureResult>;

  /**
   * Refund a captured payment.
   *
   * Supports full and partial refunds (if provider allows). Multiple refunds
   * are allowed until the full captured amount is refunded.
   *
   * State transition: captured → refunded (or failed)
   *                    settled → refunded (or failed)
   *
   * Idempotency: Multiple calls with the same idempotencyKey MUST return
   * the existing refund without creating a duplicate.
   *
   * @param transactionId - Provider's transaction/capture identifier
   * @param params - Refund parameters (amount, reason, idempotency key)
   * @throws {PaymentProviderError} if transaction does not exist or cannot be refunded
   */
  refund(transactionId: string, params: RefundParams): Promise<RefundResult>;

  /**
   * Query the current status of a payment.
   *
   * Returns the current state and transition history. Useful for:
   * - Polling after user completes clientActionUrl flow
   * - Reconciliation
   * - Status page / customer support
   *
   * @param paymentId - Provider's payment identifier (intent ID or transaction ID)
   * @throws {PaymentProviderError} if payment does not exist
   */
  getStatus(paymentId: string): Promise<PaymentStatusResult>;

  /**
   * Verify an inbound webhook delivery.
   *
   * Validates the webhook signature using the provider's mechanism
   * (HMAC, JWT, certificate verification, etc.). If valid, parses the
   * event payload into a normalized PaymentEvent.
   *
   * Note: The webhook-ingestion service already implements verification
   * adapters for Stripe, PayPal, and Paystack. This method is included
   * in the interface for completeness and to support future providers.
   *
   * @param rawPayload - Raw webhook body (Buffer or string, depending on provider)
   * @param headers - HTTP headers from the webhook request
   * @throws {PaymentProviderError} on verification failure (do not return valid: false for security errors)
   */
  verifyWebhook(
    rawPayload: Buffer | string,
    headers: Record<string, string | string[] | undefined>
  ): Promise<WebhookVerification>;

  /**
   * Parse a verified webhook event into a normalized payment event.
   *
   * Translates provider-specific event types and payloads into the
   * internal PaymentEvent representation used by the domain layer.
   *
   * This operation assumes the event has already been verified.
   * It should never be called on unverified input.
   *
   * @param providerEvent - Raw provider event object (already verified)
   * @returns Normalized payment event, or null if event type is not payment-related
   */
  parseWebhookEvent(providerEvent: unknown): PaymentEvent | null;
}

/**
 * Base error class for payment provider operations.
 *
 * Provider adapters should throw this (or a subclass) for any
 * provider API errors, network failures, or validation errors.
 */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code?: string,
    public readonly retryable: boolean = false,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PaymentProviderError';
    Error.captureStackTrace(this, PaymentProviderError);
  }
}
