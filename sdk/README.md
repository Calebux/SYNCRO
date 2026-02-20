# @syncro/sdk

Programmatic subscription management helpers for the [Syncro](https://syncro.app) platform.

---

## Installation

```bash
# From the monorepo root
cd sdk && npm install
```

---

## `cancelSubscription()`

Cancel a subscription, log it on-chain, and optionally redirect the user to the merchant's cancellation page.

### Option A — Standalone helper (simplest)

```ts
import { cancelSubscription } from '@syncro/sdk';

const result = await cancelSubscription({
  subscriptionId: 'sub_abc123',
  cancellationUrl: 'https://netflix.com/cancel',   // optional
  reason: 'Too expensive',                          // optional
  baseUrl: 'https://api.syncro.app',               // or set SYNCRO_BASE_URL env var
  apiKey: 'YOUR_API_KEY',                          // or set SYNCRO_API_KEY env var
});

console.log(result.success);          // true
console.log(result.status);           // "cancelled"
console.log(result.cancellationUrl);  // "https://netflix.com/cancel"
console.log(result.blockchain);       // { synced: true, transactionHash: "cx..." }

// Optional: redirect to merchant's cancellation page
if (result.cancellationUrl) {
  window.location.href = result.cancellationUrl;
}
```

### Option B — `SyncroSDK` class (EventEmitter, reusable)

```ts
import { SyncroSDK } from '@syncro/sdk';

const sdk = new SyncroSDK({
  baseUrl: 'https://api.syncro.app',
  apiKey: 'YOUR_API_KEY',
});

// Listen for events
sdk.on('cancellation:success', (status) => {
  console.log('✅ Cancelled on-chain:', status.blockchain.transactionHash);
});

sdk.on('cancellation:failure', (status) => {
  console.error('❌ Cancellation failed:', status.error);
});

// Cancel a subscription
const result = await sdk.cancelSubscription({
  subscriptionId: 'sub_abc123',
  cancellationUrl: 'https://netflix.com/cancel',
  reason: 'No longer needed',
});
```

---

## `CancellationStatus` Reference

| Field                         | Type      | Description                                              |
|-------------------------------|-----------|----------------------------------------------------------|
| `success`                     | `boolean` | `true` when the subscription was cancelled in the DB     |
| `subscriptionId`              | `string`  | The ID passed in                                         |
| `status`                      | `string`  | `"cancelled"` on success                                 |
| `cancellationUrl`             | `string?` | Merchant redirect URL (echoed from input if provided)    |
| `blockchain.synced`           | `boolean` | `true` = on-chain event confirmed                        |
| `blockchain.transactionHash`  | `string?` | Soroban transaction hash (when contract is configured)   |
| `blockchain.error`            | `string?` | Chain-layer error (DB still updated if this is set)      |
| `error`                       | `string?` | Top-level error when `success` is `false`                |
| `subscription`                | `object?` | Full subscription record from the backend                |

---

## Events (SyncroSDK class)

| Event                  | Payload             | Fired when                                    |
|------------------------|---------------------|-----------------------------------------------|
| `cancellation:success` | `CancellationStatus`| DB updated successfully (chain may be partial)|
| `cancellation:failure` | `CancellationStatus`| DB update or network call failed              |

---

## Environment Variables

| Variable           | Description                                         |
|--------------------|-----------------------------------------------------|
| `SYNCRO_BASE_URL`  | Syncro backend URL (used by standalone helper)      |
| `SYNCRO_API_KEY`   | Bearer token (used by standalone helper)            |

---

## Backend API Endpoint

```
POST /api/subscriptions/:id/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "cancellation_url": "https://merchant.com/cancel",   // optional
  "reason": "Too expensive"                             // optional
}
```

**Response codes:**
- `200` — Cancelled + on-chain event confirmed
- `207` — DB cancelled, on-chain log failed (partial)
- `404` — Subscription not found or not owned by caller
- `409` — Subscription already cancelled
- `500` — Unexpected error

---

## On-Chain Event (Soroban)

The Syncro Soroban contract emits two events when `cancel_sub` is invoked:

1. **`SubscriptionCancelled`** — `{ sub_id, owner, cancellation_url }`
2. **`StateTransition`** — `{ sub_id, new_state: "Cancelled" }`

These events can be indexed from the Stellar network for audit and analytics.
