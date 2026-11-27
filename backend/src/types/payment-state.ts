/**
 * Internal payment state machine (Phase 1 — Foundation)
 *
 * This file defines the provider-independent payment state model and
 * allowed transitions. Provider adapters translate provider-specific
 * states into this normalized representation.
 *
 * Related: Issue #1282 — Payment provider abstraction
 * Epic: E — Backend domain rewrites (SYNCRO v2)
 */

/**
 * Normalized internal payment states.
 *
 * These states represent the domain model, not provider-specific states.
 * Provider adapters must map their native states onto this model.
 *
 * State semantics:
 * - **pending**: Payment initiated but not yet authorized (user action may be required)
 * - **authorized**: Payment method validated and funds reserved, but not captured
 * - **captured**: Funds captured and in transit (settlement pending)
 * - **settled**: Funds successfully transferred to merchant account
 * - **failed**: Payment failed at any stage (terminal state)
 * - **refunded**: Payment was captured/settled but later refunded (terminal state)
 *
 * Note: Not all providers expose all states. For example:
 * - Stripe distinguishes authorized vs. captured for manual capture flows
 * - PayPal combines authorization and capture in express checkout
 * - Paystack does not expose settlement events separately from capture
 *
 * Adapters should map provider states to the closest semantic equivalent.
 */
export type PaymentState =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'settled'
  | 'failed'
  | 'refunded';

/**
 * Allowed state transitions.
 *
 * This defines the valid payment state machine. Transitions that are not
 * listed here should not occur under normal operation. If a provider
 * reports an unexpected transition, it should be logged as an anomaly.
 *
 * Transition semantics:
 * - pending → authorized: Payment method validated, funds reserved
 * - pending → failed: Payment method rejected or user abandoned flow
 * - authorized → captured: Merchant captured the authorized funds
 * - authorized → failed: Capture failed or authorization expired
 * - captured → settled: Provider completed fund transfer to merchant
 * - captured → failed: Settlement failed (rare; usually requires manual intervention)
 * - settled → refunded: Merchant issued a refund
 * - captured → refunded: Refund processed before settlement completed (provider-dependent)
 *
 * Note: Some providers may report transitions we don't explicitly model:
 * - Stripe: requires_action → processing → succeeded
 * - PayPal: CREATED → APPROVED → COMPLETED
 * - Paystack: pending → success (no separate authorized state)
 *
 * Adapters should collapse these into the transitions above.
 */
export type PaymentStateTransition =
  | 'pending->authorized'
  | 'pending->failed'
  | 'authorized->captured'
  | 'authorized->failed'
  | 'captured->settled'
  | 'captured->failed'
  | 'captured->refunded'
  | 'settled->refunded';

/**
 * Validates whether a state transition is allowed.
 *
 * @param from - Current payment state
 * @param to - Target payment state
 * @returns true if the transition is valid, false otherwise
 */
export function isValidTransition(from: PaymentState, to: PaymentState): boolean {
  const transition = `${from}->${to}` as PaymentStateTransition;
  const validTransitions: PaymentStateTransition[] = [
    'pending->authorized',
    'pending->failed',
    'authorized->captured',
    'authorized->failed',
    'captured->settled',
    'captured->failed',
    'captured->refunded',
    'settled->refunded',
  ];
  return validTransitions.includes(transition);
}

/**
 * Record of a state transition.
 *
 * Payment providers should emit these events, and the domain layer
 * stores them as an audit trail.
 */
export interface PaymentTransition {
  /** State before the transition */
  fromState: PaymentState;
  /** State after the transition */
  toState: PaymentState;
  /** ISO 8601 timestamp when the transition occurred */
  transitionedAt: string;
  /** Reason or trigger for the transition (e.g., 'user_completed_3ds', 'capture_requested') */
  reason?: string;
}

/**
 * Normalized payment event.
 *
 * Provider webhook adapters translate provider-specific events into this
 * common representation. This allows the domain layer to handle all providers
 * uniformly.
 *
 * Provider-specific event types are mapped as follows:
 * - Stripe: payment_intent.* → event_type: 'intent_status_changed'
 * - PayPal: PAYMENT.CAPTURE.COMPLETED → event_type: 'capture_completed'
 * - Paystack: charge.success → event_type: 'charge_succeeded'
 *
 * The adapter should populate `providerEventType` with the original type
 * for debugging and audit purposes.
 */
export interface PaymentEvent {
  /** Our normalized event type */
  eventType: PaymentEventType;
  /** Provider's payment identifier */
  paymentId: string;
  /** New payment state (if this event represents a state change) */
  state?: PaymentState;
  /** State transition details (if applicable) */
  transition?: PaymentTransition;
  /** ISO 8601 timestamp of the event (from provider) */
  occurredAt: string;
  /** Provider-specific event type (for audit and debugging) */
  providerEventType: string;
  /** Provider name */
  provider: string;
  /**
   * Provider-specific event metadata.
   * Stored for audit but not interpreted by domain logic.
   */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Normalized event types.
 *
 * These are domain-level event classifications. Provider adapters
 * map their native event types onto these categories.
 */
export type PaymentEventType =
  | 'intent_created'
  | 'intent_authorized'
  | 'intent_failed'
  | 'capture_completed'
  | 'capture_failed'
  | 'settlement_completed'
  | 'refund_initiated'
  | 'refund_completed'
  | 'refund_failed'
  | 'unknown';

/**
 * Helper to determine terminal states.
 *
 * Terminal states are those where no further transitions are expected.
 * Payments in these states can be considered "done" from a state machine perspective.
 */
export function isTerminalState(state: PaymentState): boolean {
  return state === 'failed' || state === 'refunded';
}

/**
 * Helper to determine if a state represents a successful payment.
 *
 * Successful states are those where the merchant has received (or will receive) funds.
 */
export function isSuccessfulState(state: PaymentState): boolean {
  return state === 'captured' || state === 'settled';
}

/**
 * Helper to determine if a state allows refunds.
 *
 * Only captured and settled payments can be refunded.
 */
export function isRefundableState(state: PaymentState): boolean {
  return state === 'captured' || state === 'settled';
}

/**
 * Payment state metadata for application use.
 *
 * This is supplementary information about a payment's state,
 * useful for UI rendering, notifications, etc.
 */
export interface PaymentStateMetadata {
  state: PaymentState;
  /** Human-readable description */
  description: string;
  /** Whether this state is terminal (no more transitions expected) */
  terminal: boolean;
  /** Whether this represents a successful payment from merchant perspective */
  successful: boolean;
  /** Whether a refund can be issued */
  refundable: boolean;
}

/**
 * Get metadata for a payment state.
 */
export function getStateMetadata(state: PaymentState): PaymentStateMetadata {
  const metadata: Record<PaymentState, PaymentStateMetadata> = {
    pending: {
      state: 'pending',
      description: 'Payment initiated, awaiting user action or provider confirmation',
      terminal: false,
      successful: false,
      refundable: false,
    },
    authorized: {
      state: 'authorized',
      description: 'Payment method validated and funds reserved',
      terminal: false,
      successful: false,
      refundable: false,
    },
    captured: {
      state: 'captured',
      description: 'Funds captured and in transit',
      terminal: false,
      successful: true,
      refundable: true,
    },
    settled: {
      state: 'settled',
      description: 'Funds successfully transferred to merchant account',
      terminal: false, // Can still transition to refunded
      successful: true,
      refundable: true,
    },
    failed: {
      state: 'failed',
      description: 'Payment failed',
      terminal: true,
      successful: false,
      refundable: false,
    },
    refunded: {
      state: 'refunded',
      description: 'Payment was refunded',
      terminal: true,
      successful: false,
      refundable: false,
    },
  };

  return metadata[state];
}
