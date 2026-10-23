# Payment Provider Contract

**Status**: Foundation (Phase 1 of Issue #1282)  
**Epic**: E — Backend domain rewrites (SYNCRO v2)

## Overview

This document describes the provider-agnostic payment contract that standardizes how SYNCRO interacts with payment providers (Stripe, PayPal, Paystack). The contract consists of:

1. **PaymentProvider interface** — Domain operations that every provider adapter must implement
2. **Internal payment state machine** — Provider-independent state model
3. **Normalized event types** — Common representation for webhook events

## Purpose

Prior to this contract, payment logic was spread across provider-specific services with inconsistent patterns:

- **Refunds**: Hardcoded to Stripe; PayPal refunds did not work (closed issue)
- **State handling**: Each provider exposed different states, leading to branching logic in callers
- **Webhooks**: PayPal and Paystack had state-machine gaps that Stripe did not (open issues)
- **Testing**: No shared conformance suite; bugs in one provider were not caught in others

This contract establishes a **single interface** that all providers conform to, enabling:

- **Provider-agnostic callers**: Payment routes do not branch on provider name
- **Uniform testing**: One conformance suite runs against all adapters
- **Consistent behavior**: Refunds, captures, and status queries work identically across providers
- **Clear state semantics**: Internal state machine is documented and enforced

## Payment State Machine

### States

The internal payment state model defines six states:

| State          | Description                                                   | Terminal? | Successful? | Refundable? |
|----------------|---------------------------------------------------------------|-----------|-------------|-------------|
| **pending**    | Payment initiated but not yet authorized                      | No        | No          | No          |
| **authorized** | Payment method validated and funds reserved                   | No        | No          | No          |
| **captured**   | Funds captured and in transit (settlement pending)            | No        | Yes         | Yes         |
| **settled**    | Funds successfully transferred to merchant account            | No        | Yes         | Yes         |
| **failed**     | Payment failed at any stage (terminal state)                  | Yes       | No          | No          |
| **refunded**   | Payment was captured/settled but later refunded (terminal)    | Yes       | No          | No          |

### Allowed Transitions

The state machine enforces these valid transitions:

```
pending → authorized    (Payment method validated, funds reserved)
pending → failed        (Payment method rejected or user abandoned)

authorized → captured   (Merchant captured the authorized funds)
authorized → failed     (Capture failed or authorization expired)

captured → settled      (Provider completed fund transfer)
captured → failed       (Settlement failed; rare, needs manual intervention)
captured → refunded     (Refund processed before settlement completed)

settled → refunded      (Merchant issued a refund)
```

### State Semantics by Provider

Not all providers expose all states. Adapters map provider-specific states to the closest semantic equivalent:

#### Stripe
- **pending**: `requires_payment_method`, `requires_action`, `processing`
- **authorized**: `requires_capture` (manual capture flow)
- **captured**: `succeeded` (automatic capture flow)
- **settled**: Not separately exposed; treated same as captured
- **failed**: `canceled`, `failed`
- **refunded**: Refund object status `succeeded`

#### PayPal
- **pending**: Order status `CREATED`
- **authorized**: Order status `APPROVED`
- **captured**: Capture status `COMPLETED`
- **settled**: Not separately exposed; treated same as captured
- **failed**: Order/Capture status `VOIDED`, `DECLINED`
- **refunded**: Refund status `COMPLETED`

#### Paystack
- **pending**: Transaction status `pending`
- **authorized**: Not exposed separately (authorization and capture are atomic)
- **captured**: Transaction status `success`
- **settled**: Not separately exposed; treated same as captured
- **failed**: Transaction status `failed`, `abandoned`
- **refunded**: Refund API response status `success`

## PaymentProvider Interface

Every payment provider adapter implements the `PaymentProvider` interface:

```typescript
interface PaymentProvider {
  readonly name: string;

  createIntent(params: CreateIntentParams): Promise<CreateIntentResult>;
  capture(intentId: string, params?: CaptureParams): Promise<CaptureResult>;
  refund(transactionId: string, params: RefundParams): Promise<RefundResult>;
  getStatus(paymentId: string): Promise<PaymentStatusResult>;
  verifyWebhook(rawPayload: Buffer | string, headers: Record<string, string | string[] | undefined>): Promise<WebhookVerification>;
  parseWebhookEvent(providerEvent: unknown): PaymentEvent | null;
}
```

### Operations

#### `createIntent`
**Purpose**: Initialize a payment (authorization).

**Behavior**:
- Creates a payment intent and reserves funds (if possible)
- May require user action (3DS challenge, PayPal approval)
- Returns `clientActionUrl` if user must complete additional steps
- **State transition**: none → pending → authorized (or failed)

**Idempotency**: Multiple calls with the same `idempotencyKey` return the existing intent without creating a duplicate.

**Provider notes**:
- **Stripe**: Creates a PaymentIntent; may require client-side confirmation for 3DS
- **PayPal**: Creates an Order; user must approve via `clientActionUrl`
- **Paystack**: Initializes a transaction; user completes via hosted checkout page

---

#### `capture`
**Purpose**: Finalize a payment and trigger fund movement.

**Behavior**:
- Captures a previously authorized payment
- Some providers support partial capture (via optional `amount` param)
- If `amount` omitted, captures the full authorized amount
- **State transition**: authorized → captured (or failed)

**Provider notes**:
- **Stripe**: Supports partial capture via PaymentIntent API
- **PayPal**: Captures an approved Order; partial capture supported
- **Paystack**: Capture is automatic on transaction success (no separate step)

---

#### `refund`
**Purpose**: Return funds to the customer.

**Behavior**:
- Refunds a captured/settled payment (full or partial)
- Multiple refunds allowed until full amount is refunded
- **State transition**: captured/settled → refunded (or failed)

**Idempotency**: Multiple calls with the same `idempotencyKey` return the existing refund without creating a duplicate.

**Provider notes**:
- **Stripe**: Refund API; supports partial refunds
- **PayPal**: Refund Capture API; supports partial refunds
- **Paystack**: Refund API; full refunds only (as of current implementation)

---

#### `getStatus`
**Purpose**: Query the current status of a payment.

**Behavior**:
- Returns current state and transition history
- Useful for polling after user completes `clientActionUrl` flow
- Also used for reconciliation and customer support

**Provider notes**:
- **Stripe**: Retrieve PaymentIntent
- **PayPal**: Retrieve Order or Capture details
- **Paystack**: Verify transaction endpoint

---

#### `verifyWebhook` and `parseWebhookEvent`
**Purpose**: Validate and normalize inbound webhook events.

**Behavior**:
- `verifyWebhook`: Validates signature using provider's mechanism (HMAC, JWT, cert)
- `parseWebhookEvent`: Translates provider event into normalized `PaymentEvent`

**Note**: The existing `webhook-ingestion` service already implements verification adapters for Stripe, PayPal, and Paystack. These methods are included in the interface for completeness and to support future providers.

---

## Normalized Event Types

Provider-specific webhook events are translated into normalized `PaymentEvent` objects:

| Provider Event                  | Normalized Event Type   | State Transition       |
|---------------------------------|-------------------------|------------------------|
| Stripe: `payment_intent.created`          | `intent_created`        | none → pending         |
| Stripe: `payment_intent.succeeded`        | `capture_completed`     | authorized → captured  |
| PayPal: `PAYMENT.CAPTURE.COMPLETED`       | `capture_completed`     | authorized → captured  |
| Paystack: `charge.success`                | `capture_completed`     | pending → captured     |
| Stripe: `charge.refunded`                 | `refund_completed`      | captured → refunded    |
| PayPal: `PAYMENT.CAPTURE.REFUNDED`        | `refund_completed`      | captured → refunded    |

The `PaymentEvent` type includes:
- `eventType`: Normalized event classification
- `paymentId`: Provider's payment identifier
- `state`: New payment state (if applicable)
- `transition`: State transition details
- `occurredAt`: ISO 8601 timestamp
- `providerEventType`: Original provider event type (for audit)
- `providerMetadata`: Provider-specific data (stored but not interpreted)

---

## Implementation Phases

### Phase 1 — Foundation (Current)
**Status**: Complete  
**Deliverables**:
- ✅ `PaymentProvider` interface defined (`backend/src/types/payment-provider.ts`)
- ✅ Internal payment state machine (`backend/src/types/payment-state.ts`)
- ✅ Normalized event types
- ✅ State transition helpers
- ✅ Documentation (this file)
- ✅ Type-level verification tests

**What is NOT included**:
- Provider adapters (Stripe, PayPal, Paystack) — not yet migrated
- Provider-agnostic payment routes — existing routes still call provider services directly
- Conformance test suite — will be created in Phase 2

### Phase 2 — Adapter Implementation (Future)
**Planned**:
- Implement `StripeAdapter` conforming to `PaymentProvider`
- Implement `PayPalAdapter` conforming to `PaymentProvider`
- Implement `PaystackAdapter` conforming to `PaymentProvider`
- Create shared conformance test suite
- Run suite against all three adapters

### Phase 3 — Caller Migration (Future)
**Planned**:
- Migrate `backend/src/routes/payments.ts` to be provider-agnostic
- Implement provider selection at application edge
- Ensure refunds work identically for all providers
- Address open PayPal issues via shared state machine

---

## Design Principles

1. **Domain-driven**: The interface describes payment domain operations, not provider-specific APIs
2. **Provider-agnostic**: Callers never branch on provider name; provider selection happens once at the edge
3. **Idempotent**: Operations that can be duplicated (createIntent, refund) require idempotency keys
4. **Fail-safe**: Webhook verification failures throw errors rather than returning `valid: false` (no silent failures)
5. **Auditable**: State transitions and provider metadata are preserved for audit and debugging
6. **Testable**: A single conformance suite validates all adapters against the same behavioral contract

---

## Related Issues

- **Issue #1282**: Payment provider abstraction (this contract)
- **Closed issue**: Refund API hardcoded to Stripe; PayPal refunds did not work
- **Open PayPal issues**: State-machine gaps in capture and webhook handling

---

## Future Work

- **3DS handling**: Standardize challenge flow across providers
- **Partial captures/refunds**: Ensure consistent behavior where supported
- **Reconciliation**: Build on `getStatus` for automated payment reconciliation
- **Multi-currency**: Extend `PaymentAmount` for FX handling
- **Installments**: Model installment payments if supported by providers

---

## References

- `backend/src/types/payment-provider.ts` — Interface definitions
- `backend/src/types/payment-state.ts` — State machine implementation
- `backend/src/services/webhook-ingestion.ts` — Existing webhook verification adapters
- `backend/tests/payment-provider-contract.test.ts` — Type-level verification tests
