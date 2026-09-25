# @syncro/sdk

Official TypeScript/JavaScript SDK for the **SYNCRO** Payments Platform.

x402-compatible payment handling, Soroban contract interactions, webhook verification, and channel management. Developers should use these SDK methods instead of calling raw API endpoints or Soroban contracts directly.

> **⚠️ Deprecation notice — previous major (v1.x)**
>
> `@syncro/sdk` v1.x carried a subscription management SDK. The final v1.x release is **1.1.0**. No further v1.x patches are planned. The subscription API has been **removed** in v3.0.0 — there is no upgrade path, shim, or adapter. Existing subscription integrations must be rewritten against the v3 payments surface.

---

## Versioning and Deprecation Policy

`@syncro/sdk` follows [Semantic Versioning 2.0.0](https://semsemver.org/).

### What constitutes a breaking change (major bump)

- Removing or renaming an export listed in `sdk/api-surface.md`
- Changing a stable error `code` string or `retryable` flag
- Making a previously optional field required
- Narrowing an accepted type or widening a returned type in a way that breaks existing consumers

### What is a non-breaking addition (minor bump)

- New exported symbol
- New optional field on an existing interface
- New error subclass
- New method on a client class

### Deprecation window

1. A symbol is marked `@deprecated` in JSDoc for at least **one minor release** before removal.
2. The `[Unreleased]` section of `CHANGELOG.md` must document the deprecation.
3. Removal ships in the next **major** version.

### Experimental APIs

Unstable/preview exports live under the `./experimental` sub-path and may change in any release:

```typescript
import { something } from "@syncro/sdk/experimental";
```

### API Surface report

`sdk/api-surface.md` is committed to the repo and lists every public symbol.
CI (`npm run check:api-surface -w sdk`) fails when a new export is added
without updating the report — making surface changes visible in review.

---

## Installation

```bash
npm install @syncro/sdk
```

## Quick Start — v3 Payments

```typescript
import { createPaidFetch } from "@syncro/sdk/v3";

const fetch = createPaidFetch({ spendingKey: "..." });
const res = await fetch("https://api.syncro.example.com/charge");

if (res.receipt) {
  console.log("Payment settled:", res.receipt.transaction);
}
```

## Configuration

```typescript
import { pricing, metered, hostedGateway } from "@syncro/sdk";

// Route pricing — match HTTP method + path to a price
const route = pricing({
  defaultPrice: 0.01,
  currency: "USDC",
  "GET /api/charge": 0.05,
  "POST /api/charge": 0.10,
});

// Metered pricing — charge by unit quantity
const meteredRoute = metered({
  unit: "request",
  pricePerUnit: 0.001,
});

// Hosted gateway — delegate payment to a gateway
const gateway = hostedGateway({
  gatewayUrl: "https://gateway.syncro.example.com",
  apiKey: "gw_key_...",
});
```

## Receipt Verification

```typescript
import { verifyReceipt, decodeReceiptHeader } from "@syncro/sdk";

const receipt = decodeReceiptHeader(headers["x-syncro-receipt"]);
const ok = verifyReceipt(receipt);
if (!ok) throw new Error("Invalid receipt");
```

## Webhook Verification

```typescript
import {
  verifyWebhookSignature,
  parseWebhookHeaders,
  createWebhookHandler,
  SYNCRO_WEBHOOK_HEADERS,
} from "@syncro/sdk";

// Express-style example
app.post("/webhooks/syncro", express.raw({ type: "application/json" }), async (req, res) => {
  const rawBody = req.body.toString("utf8");
  const headers = parseWebhookHeaders(req.headers);
  const secret = process.env.SYNCRO_WEBHOOK_SECRET!;

  if (!headers.signature || !verifyWebhookSignature(rawBody, headers.signature, secret)) {
    return res.status(401).send("Invalid signature");
  }

  const event = JSON.parse(rawBody);
  // Handle event ...

  res.status(200).send("OK");
});

// Or use the bundled handler factory
const handleSyncroWebhook = createWebhookHandler(process.env.SYNCRO_WEBHOOK_SECRET!, {
  "subscription.renewed": async (event) => {
    console.log("Renewed:", event.data.subscription_name);
  },
});
```

### Delivery headers

| Header | Constant | Purpose |
|--------|----------|---------|
| `X-Syncro-Signature` | `SYNCRO_WEBHOOK_HEADERS.signature` | HMAC-SHA256 hex digest of the raw JSON body |
| `X-Syncro-Delivery-Id` | `SYNCRO_WEBHOOK_HEADERS.deliveryId` | Unique delivery identifier |
| `X-Syncro-Retry-Count` | `SYNCRO_WEBHOOK_HEADERS.retryCount` | Retry attempt number for redeliveries |
| `X-Syncro-Replay-Id` | `SYNCRO_WEBHOOK_HEADERS.replayId` | Identifier when replaying from dead-letter queue |

Always verify signatures against the **raw request body** string. Re-serializing parsed JSON can invalidate the signature.

## Stellar Transaction Memos

SYNCRO uses a compact, standardized memo format for Stellar transactions to support cross-platform receipt verification.

**Format:** `S1:<type>:<subscriptionIdHash>`

`subscriptionIdHash` is the first 12 hex characters of `SHA-256(subscriptionId)`.

```typescript
import {
  buildSyncroMemo,
  parseSyncroMemo,
  validateSyncroMemo,
  verifyTransactionMemo,
} from "@syncro/sdk/stellar";

const memo = buildSyncroMemo("create", subscriptionId);
// => "S1:c:a1b2c3d4e5f6"

const parsed = parseSyncroMemo(memo);
const isValid = validateSyncroMemo(memo, "create", subscriptionId);

const receiptOk = verifyTransactionMemo(
  { memo, successful: true, hash: txHash },
  "create",
  subscriptionId,
);
```

Legacy memos that do not match the `S1:` format are treated as backward-compatible/unparsed.

## Error Handling

The SDK throws typed errors so you can handle them precisely:

```typescript
import {
  SyncroError,
  NotFoundError,
  AuthError,
  RateLimitError,
  ValidationError,
} from "@syncro/sdk";

try {
  await sdk.getSubscription("bad-id");
} catch (err) {
  if (err instanceof NotFoundError) {
    console.error("Not found:", err.message); // err.code === "NOT_FOUND"
  } else if (err instanceof AuthError) {
    console.error("Check your API key");
  } else if (err instanceof RateLimitError) {
    console.error(`Rate limited. Retry after ${err.retryAfter}s`);
  } else if (err instanceof SyncroError) {
    console.error(`SDK error [${err.code}]:`, err.message);
  }
}
```

## Using Types Only (`@syncro/sdk/types`)

You can import types without the runtime SDK:

```typescript
import type {
  RetryOptions,
  StellarWallet,
  StellarKeypair,
  PaidReceipt,
  PaidReceiptPayload,
} from "@syncro/sdk/types";
```

## Sub-path Exports

| Sub-path | Description |
|----------|-------------|
| `@syncro/sdk` | Main entry — payments utilities, webhooks, receipts, Stellar memos, contract bindings, pricing, channels |
| `@syncro/sdk/v3` | v3 payments API — `GatewayClient`, `createPaidFetch`, receipt verification, retry, gateway errors |
| `@syncro/sdk/webhooks` | Webhook verification helpers |
| `@syncro/sdk/stellar` | Stellar memo build/parse/verify utilities |
| `@syncro/sdk/zk` | Zero-knowledge proof utilities |
| `@syncro/sdk/contracts` | Soroban contract transaction builders |
| `@syncro/sdk/types` | TypeScript types only (no runtime) |
| `@syncro/sdk/crypto` | Cryptographic primitives (browser/node dual build) |
| `@syncro/sdk/experimental` | Unstable/preview exports — may change in any release |

## License

MIT
