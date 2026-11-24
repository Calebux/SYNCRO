# PayPal Integration Guide

## Overview

SYNCRO includes a production-ready PayPal integration using the PayPal Orders API v2. This integration supports:

- ✅ Real PayPal API integration (no mocked responses)
- ✅ OAuth 2.0 authentication with token caching
- ✅ Automatic retry logic for transient failures
- ✅ Comprehensive error handling
- ✅ Webhook support for payment status updates
- ✅ Database persistence with idempotency
- ✅ Refund processing
- ✅ Feature flag protection

## Architecture

### Payment Flow

```
┌─────────┐         ┌──────────┐         ┌─────────┐         ┌──────────┐
│ Client  │────────▶│   API    │────────▶│ Payment │────────▶│  PayPal  │
│         │         │  Route   │         │ Service │         │   API    │
└─────────┘         └──────────┘         └─────────┘         └──────────┘
     │                    │                    │                    │
     │                    │                    │                    │
     │              ┌─────▼─────┐              │                    │
     │              │ Database  │◀─────────────┘                    │
     │              │ (Supabase)│                                   │
     │              └───────────┘                                   │
     │                    ▲                                         │
     │                    │                                         │
     │                    └─────────────────────────────────────────┘
     │                           Webhook Events
     │
     └──────────────────────────────────────────────────────────────┘
                    User Approval (Redirect)
```

### Components

1. **PayPalService** (`client/lib/paypal-service.ts`)
   - OAuth authentication
   - Order creation and capture
   - Refund processing
   - Retry logic with exponential backoff
   - Error parsing and handling

2. **PaymentService** (`client/lib/payment-service.ts`)
   - Multi-provider orchestration (Stripe, PayPal, Mock)
   - Database persistence
   - Feature flag validation

3. **API Routes**
   - `/api/payments` - Create payment/order
   - `/api/payments/paypal/capture` - Capture approved order
   - `/api/webhooks/paypal` - Handle PayPal webhooks

4. **Database**
   - `payments` table - Payment records
   - `webhook_events` table - Webhook event tracking

## Setup

### 1. Get PayPal Credentials

1. Visit [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/)
2. Create a new app (or use existing)
3. Copy the **Client ID** and **Secret**
4. Note the mode (Sandbox for testing, Live for production)

### 2. Configure Environment Variables

```bash
# Required for PayPal
PAYPAL_CLIENT_ID=your_client_id_here
PAYPAL_CLIENT_SECRET=your_secret_here
PAYPAL_MODE=sandbox  # or 'live' for production

# Optional - for webhook signature verification
PAYPAL_WEBHOOK_ID=your_webhook_id_here

# App URL for redirects
NEXT_PUBLIC_APP_URL=https://your-app.com
```

### 3. Set Up Webhooks

1. In PayPal Developer Dashboard, go to your app
2. Add webhook URL: `https://your-app.com/api/webhooks/paypal`
3. Subscribe to events:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.DENIED`
   - `PAYMENT.CAPTURE.REFUNDED`
   - `CHECKOUT.ORDER.APPROVED`
   - `CHECKOUT.ORDER.COMPLETED`
4. Copy the Webhook ID and add to `PAYPAL_WEBHOOK_ID`

### 4. Run Database Migrations

```bash
# Apply the webhook_events table migration
psql $DATABASE_URL -f client/scripts/022_create_webhook_events.sql
```

## Usage

### Creating a Payment

```typescript
import { PaymentService } from '@/lib/payment-service'

const paymentService = new PaymentService({ provider: 'paypal' })

// Step 1: Create order
const result = await paymentService.processPayment(
  100,           // amount in dollars
  'USD',         // currency
  'new-order',   // token (use 'new-order' for new orders)
  {
    userId: 'user-123',
    planName: 'Pro Plan',
    userEmail: 'user@example.com',
  }
)

if (result.success && result.requiresAction) {
  // Redirect user to PayPal for approval
  window.location.href = result.actionUrl
}
```

### Capturing a Payment

After user approves on PayPal and returns to your app:

```typescript
// Step 2: Capture the approved order
const captureResult = await paymentService.processPayment(
  0,                      // amount not needed for capture
  'USD',
  `order_${orderId}`,    // prefix with 'order_'
  {
    userId: 'user-123',
    planName: 'Pro Plan',
    userEmail: 'user@example.com',
  }
)

if (captureResult.success) {
  console.log('Payment captured:', captureResult.transactionId)
}
```

### Processing Refunds

```typescript
const paymentService = new PaymentService({ provider: 'paypal' })

const refundResult = await paymentService.refundPayment('CAPTURE-123')

if (refundResult.success) {
  console.log('Refund processed:', refundResult.transactionId)
}
```

## API Reference

### PayPalService

#### `createOrder(amount, currency, metadata)`

Creates a new PayPal order.

**Parameters:**
- `amount` (number) - Payment amount
- `currency` (string) - Currency code (e.g., 'USD')
- `metadata` (object):
  - `userId` (string) - User ID
  - `planName` (string) - Plan name
  - `returnUrl` (string) - Success redirect URL
  - `cancelUrl` (string) - Cancel redirect URL

**Returns:** `Promise<PayPalOrderResponse>`

#### `captureOrder(orderId)`

Captures an approved order.

**Parameters:**
- `orderId` (string) - PayPal order ID

**Returns:** `Promise<PayPalCaptureResponse>`

#### `refundCapture(captureId, amount?, currency?)`

Refunds a captured payment.

**Parameters:**
- `captureId` (string) - PayPal capture ID
- `amount` (number, optional) - Partial refund amount
- `currency` (string, optional) - Currency code

**Returns:** `Promise<any>`

## Error Handling

### Retry Logic

The PayPal service automatically retries failed requests with exponential backoff:

- **Max retries:** 3 (configurable)
- **Retry delay:** 1000ms base (configurable)
- **Retryable errors:** 5xx, 408, 429
- **Non-retryable errors:** 4xx (except 408, 429)

### Error Types

```typescript
try {
  await paypalService.createOrder(...)
} catch (error) {
  if (error.statusCode === 400) {
    // Client error - invalid request
  } else if (error.statusCode >= 500) {
    // Server error - PayPal issue
  } else {
    // Network or other error
  }
}
```

## Database Schema

### payments table

```sql
create table payments (
  id uuid primary key,
  user_id uuid references auth.users(id),
  amount numeric not null,
  currency text not null,
  status text not null,  -- 'pending', 'succeeded', 'failed', 'refunded'
  provider text not null, -- 'paypal'
  transaction_id text unique,
  plan_name text,
  metadata jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
);
```

### webhook_events table

```sql
create table webhook_events (
  id uuid primary key,
  provider text not null,
  event_id text not null,
  event_type text not null,
  event_data jsonb not null,
  processed boolean default false,
  processed_at timestamp with time zone,
  created_at timestamp with time zone,
  constraint webhook_events_provider_event_id_unique unique (provider, event_id)
);
```

## Testing

### Unit Tests

```bash
cd client
npm test -- payment-service.test.ts
```

### Integration Tests

```bash
cd client
npm test -- paypal-payment-flow.test.ts
```

### Manual Testing with Sandbox

1. Set `PAYPAL_MODE=sandbox`
2. Use PayPal sandbox credentials
3. Create a test buyer account in PayPal Developer Dashboard
4. Test the complete flow:
   - Create order
   - Approve with sandbox account
   - Capture payment
   - Process refund

## Production Checklist

- [ ] PayPal credentials configured (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`)
- [ ] `PAYPAL_MODE` set to `live`
- [ ] Webhook endpoint configured in PayPal Dashboard
- [ ] `PAYPAL_WEBHOOK_ID` set for signature verification
- [ ] Database migrations applied
- [ ] SSL/TLS enabled for webhook endpoint
- [ ] Error monitoring configured (Sentry)
- [ ] Payment reconciliation process in place
- [ ] Tested in sandbox environment
- [ ] Compliance requirements met (PCI DSS, etc.)

## Monitoring

### Key Metrics

- Payment success rate
- Average payment processing time
- Webhook processing latency
- Retry attempts
- Error rates by type

### Logging

All PayPal operations are logged with structured logging:

```typescript
console.log('[PayPalService] Order created successfully:', orderId)
console.error('[PayPalService] Capture failed:', error)
```

### Webhook Events

Monitor webhook events in the `webhook_events` table:

```sql
-- Check recent webhook events
SELECT event_type, processed, created_at
FROM webhook_events
WHERE provider = 'paypal'
ORDER BY created_at DESC
LIMIT 10;

-- Check unprocessed events
SELECT COUNT(*)
FROM webhook_events
WHERE provider = 'paypal' AND processed = false;
```

## Troubleshooting

### Common Issues

#### "PayPal is not configured"

**Cause:** Missing `PAYPAL_CLIENT_ID` or `PAYPAL_CLIENT_SECRET`

**Solution:** Set environment variables and restart the application

#### "Payment capture failed"

**Cause:** Order not approved by user or already captured

**Solution:** Check order status with `getOrder()` before capturing

#### "Webhook signature verification failed"

**Cause:** Missing or incorrect `PAYPAL_WEBHOOK_ID`

**Solution:** Get webhook ID from PayPal Dashboard and update environment variable

#### Duplicate payments

**Cause:** Multiple capture attempts

**Solution:** Database idempotency checks prevent duplicates. Check `transaction_id` uniqueness.

## Security

### Best Practices

1. **Never expose credentials** - Keep `PAYPAL_CLIENT_SECRET` server-side only
2. **Verify webhooks** - Always verify webhook signatures in production
3. **Use HTTPS** - Webhook endpoints must use SSL/TLS
4. **Validate amounts** - Always validate payment amounts server-side
5. **Implement rate limiting** - Protect webhook endpoints from abuse
6. **Log security events** - Monitor for suspicious activity
7. **Regular audits** - Review payment records and webhook events

### PCI Compliance

PayPal handles all payment data, so your application doesn't need to be PCI compliant. However:

- Never store credit card numbers
- Use PayPal's hosted checkout flow
- Don't log sensitive payment data

## Support

### Resources

- [PayPal Developer Documentation](https://developer.paypal.com/docs/)
- [PayPal Orders API Reference](https://developer.paypal.com/docs/api/orders/v2/)
- [PayPal Webhooks Guide](https://developer.paypal.com/api/rest/webhooks/)

### Internal Documentation

- `docs/archive/ISSUE_496_COMPLETE.md` - Implementation details
- `client/lib/paypal-service.ts` - Service implementation
- `client/__tests__/lib/payment-service.test.ts` - Unit tests
- `client/__tests__/integration/paypal-payment-flow.test.ts` - Integration tests

## Changelog

### 2026-06-01 - Production Enhancements
- Added automatic retry logic with exponential backoff
- Implemented webhook support for payment status updates
- Enhanced error handling with specific error codes
- Added database idempotency checks
- Created comprehensive integration tests
- Updated documentation

### 2026-04-27 - Initial Implementation
- Real PayPal Orders API v2 integration
- OAuth 2.0 authentication
- Order creation and capture
- Refund processing
- Feature flag protection
- Database persistence
