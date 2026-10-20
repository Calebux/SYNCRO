# SYNCRO Provider Guide — gateway providers

## Modes

Providers register with `mode: 'staging' | 'production'`.

- `staging` — sandbox for testing the full paid flow without real funds.
- `production` — live traffic only.

## Staging (sandbox) rules

- **Testnet only.** Staging providers run against `STELLAR_NETWORK=testnet`
  (never `mainnet`).
- **Test asset only.** Settle sandbox calls with the designated test asset
  (e.g. `TEST-USDC`); never real USDC.
- **Separate keys and data.** Use dedicated testnet payout/settlement keys
  for staging. Staging settlements, receipts, and stats are kept separate
  from production and are excluded from production revenue/stats.
- **Mainnet is refused.** The gateway rejects any paid call to a staging
  provider when `STELLAR_NETWORK=mainnet` with
  `staging_mainnet_forbidden`. Staging routes never receive mainnet traffic.
- **Promotion path.** To go live, register a separate `production` provider
  with production keys, verify its payout address, and register production
  routes. Do not flip a staging provider into production.

## Provider Authentication

All provider management routes (`/api/v3/providers/:providerId/*`) require
provider authentication via the `x-provider-key` header. The secret key is
returned at registration time and must be kept confidential.

```ts
// 1. Register a staging provider with testnet keys.
const { data: provider } = await service.registerProvider({
  identity: 'acme-sandbox',
  payoutAddress: '<TESTNET_G...>',
  upstreamBaseUrl: 'https://sandbox.acme.example',
  agreementTerms: 'sandbox terms',
  mode: 'staging',
});

// provider.providerSecret is returned once — store it securely.
const providerSecret = provider.providerSecret;

// 2. Use the secret for all subsequent provider management requests.
await fetch('/api/v3/providers/<providerId>/routes', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-provider-key': providerSecret,
  },
  body: JSON.stringify({ pathPattern: '/echo/*', method: 'POST', unit: 'request', price: 1 }),
});
```

### Auth behaviour

| Scenario | Response |
|---|---|
| No `x-provider-key` header | **401 Unauthorized** |
| Invalid or unknown key | **401 Unauthorized** |
| Valid key, wrong providerId in URL | **403 Forbidden** |
| Valid key, matching providerId | **Proceeds normally** |

### Public endpoints

The following endpoints remain public (no `x-provider-key` required):

- `POST /api/v3/providers` — registration
- `POST /api/v3/providers/:providerId/payout-challenge` — generate a payout challenge
- `GET /api/v3/receipts/:receiptId` — receipt lookup

## Example

```ts
// 1. Register a staging provider with testnet keys.
service.registerProvider({
  identity: 'acme-sandbox',
  payoutAddress: '<TESTNET_G...>',
  upstreamBaseUrl: 'https://sandbox.acme.example',
  agreementTerms: 'sandbox terms',
  mode: 'staging',
});

// 2. Calls only succeed with STELLAR_NETWORK=testnet.
//    With STELLAR_NETWORK=mainnet the gateway throws:
//    "staging providers cannot serve mainnet traffic
//     (staging_mainnet_forbidden)..."
```
