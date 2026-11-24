# Stripe Production Readiness

> **Status**: ✅ Production-ready  
> **Last reviewed**: 2026-05-27  
> **Backlog ID**: #49

---

## 1. Environment Variables

| Variable | Purpose | Required in Production |
|---|---|---|
| `STRIPE_LIVE_SECRET_KEY` | Live-mode Stripe secret key (`sk_live_…`) | ✅ Yes |
| `STRIPE_TEST_SECRET_KEY` | Test-mode Stripe secret key (`sk_test_…`) | Staging/Dev only |
| `STRIPE_SECRET_KEY` | Generic fallback (legacy support) | Optional fallback |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification secret (`whsec_…`) | ✅ Yes |

### Live / Test Mode Separation

Key resolution in `lib/stripe-config.ts` follows this priority:

1. **Explicit `apiKey` argument** — used in tests and manual overrides.
2. **Environment-specific key**:
   - `NODE_ENV=production` → `STRIPE_LIVE_SECRET_KEY`
   - Otherwise → `STRIPE_TEST_SECRET_KEY`
3. **`STRIPE_SECRET_KEY`** — generic fallback for backward compatibility.

A runtime warning is logged if a test key (`sk_test_*`) is detected in a `production` environment.

---

## 2. End-to-End Checkout Flow

```
┌──────────┐     POST /api/payments      ┌──────────────┐
│  Client   │ ──────────────────────────▶ │ Payments API │
│ (Browser) │                             │  (Next.js)   │
└──────────┘                             └──────┬───────┘
                                                │
                                    PaymentService.processPayment()
                                                │
                                  ┌─────────────┼─────────────┐
                                  ▼             ▼             ▼
                            ┌─────────┐  ┌──────────┐  ┌──────────┐
                            │  Stripe │  │  PayPal  │  │   Mock   │
                            └────┬────┘  └──────────┘  └──────────┘
                                 │
                   stripe.paymentIntents.create()
                                 │
                      ┌──────────┴──────────┐
                      ▼                     ▼
               succeeded               requires_action
                      │                     │
         Save to Supabase DB       (redirect / 3DS)
                      │
                 Return 201 to client
```

### Steps

1. **Client** sends `POST /api/payments` with `{ amount, currency, token, planName, provider }`.
2. **Payments API** validates the request body with Zod, checks auth, and checks feature flags.
3. **PaymentService** creates a Stripe `PaymentIntent` (or delegates to PayPal/Mock).
4. On success, the payment is **saved to the `payments` table** in Supabase.
5. The response is returned to the client.

### Webhook Confirmation

Stripe also sends **`payment_intent.succeeded`** or **`payment_intent.payment_failed`** webhooks independently. The webhook handler:
- Verifies the `stripe-signature` header against `STRIPE_WEBHOOK_SECRET`.
- Updates the `payments` table status.
- Updates the user's `profiles.subscription_tier` if metadata is present.

---

## 3. Webhook Event Handling

### Route: `POST /api/webhooks/stripe`

| Event Type | Action |
|---|---|
| `payment_intent.succeeded` | Update `payments.status` → `succeeded`, update `profiles.subscription_tier` |
| `payment_intent.payment_failed` | Update `payments.status` → `failed` |
| Other events | Logged and acknowledged |

### Failure Recovery

If any Supabase database operation fails during webhook processing, the route returns a **`500 Internal Server Error`** instead of `200 OK`. This ensures that **Stripe's built-in retry mechanism** will automatically re-deliver the event (up to ~3 days with exponential backoff).

An outer `try/catch` also catches unexpected exceptions and responds with `500`.

---

## 4. Refund Handling

### Route: `POST /api/payments/refund`

1. **Ownership check**: Verifies the payment belongs to the authenticated user (via `checkOwnership`).
2. **Idempotency**: Rejects refund requests for already-refunded payments.
3. **Stripe refund**: Calls `stripe.refunds.create({ payment_intent: transactionId })`.
4. **DB update**: Sets `payments.status` → `refunded`.

The `PaymentService.refundPayment()` method supports Stripe, PayPal, and Mock providers.

---

## 5. Security Considerations

- **Webhook signature verification** is mandatory. Requests without a valid `stripe-signature` header are rejected with `400`.
- **RLS (Row-Level Security)** is enabled on the `payments` table. Users can only `SELECT` their own payments.
- **Rate limiting** is applied to both the payment creation and refund routes via `RateLimiters.strict`.
- **Mock payments are disabled in production** via the `isPaymentProviderEnabled('mock')` check — mock payments require `NODE_ENV=development` or `ENABLE_MOCK_PAYMENTS=true`.

---

## 6. Database Schema

```sql
-- payments table
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  amount numeric not null,
  currency text not null default 'USD',
  status text not null,        -- 'succeeded', 'failed', 'pending', 'refunded'
  provider text not null,      -- 'stripe', 'paypal'
  transaction_id text unique,
  plan_name text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
```

**Indexes**: `user_id`, `transaction_id`, `status`.

---

## 7. Test Coverage

| Test File | Coverage |
|---|---|
| `app/api/webhooks/__tests__/stripe.test.ts` | Signature validation, event processing, DB updates, idempotency, DB failure recovery |
| `lib/__tests__/payment-service.test.ts` | Stripe/PayPal/Mock payment processing, refunds, DB error handling |
| `app/api/payments/__tests__/route.test.ts` | Payment creation validation, processing failures |

---

## 8. Pre-Go-Live Checklist

- [x] Live/Test mode key separation implemented
- [x] `STRIPE_WEBHOOK_SECRET` used for signature verification
- [x] Webhook handler returns 500 on DB failure (enables Stripe retries)
- [x] Refund flow verified with ownership checks
- [x] Mock payments disabled in production
- [x] RLS enabled on payments table
- [x] Rate limiting on payment endpoints
- [x] Test coverage for all critical paths
- [x] Documentation complete
