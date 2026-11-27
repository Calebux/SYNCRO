# Exchange Rate Providers

## Overview

Exchange rates are used for client-side currency conversion in the dashboard and analytics views. The backend fetches rates from external APIs, caches them in memory, and exposes them via `GET /api/exchange-rates`.

---

## Provider Fallback Order

Providers are tried **in order**. If a provider fails, the service continues with the remaining providers and merges whatever rates were collected. Only if **all** providers fail does the service fall back to cached or static data.

| Priority | Provider | Class | External API | Currencies |
|---|---|---|---|---|
| 1 (primary) | ExchangeRate-API | `FiatRateProvider` | `https://api.exchangerate-api.com/v4/latest/{base}` | USD, EUR, GBP, CAD, AUD, JPY, NGN, GHS, KES, ZAR |
| 2 (fiat fallback) | Frankfurter / ECB | `FrankfurterProvider` | `https://api.frankfurter.app/latest?from={base}` | USD, EUR, GBP, CAD, AUD, JPY, NGN, GHS, KES, ZAR |
| 3 (crypto) | CoinGecko | `CryptoRateProvider` | `https://api.coingecko.com/api/v3/simple/price` | XLM, USDC |

**Notes:**
- ExchangeRate-API and Frankfurter cover the same fiat currencies. If ExchangeRate-API is unavailable, Frankfurter's rates are used instead.
- CoinGecko is independent and only covers crypto assets. A CoinGecko failure does not affect fiat rates.
- Neither fiat provider requires an API key. Frankfurter is backed by the European Central Bank (ECB).

---

## Caching Rules

| Scenario | Behaviour |
|---|---|
| Cache entry exists and is within TTL | Returned immediately; no provider calls made |
| Cache entry is expired (or absent) | All providers are called; result is cached and returned |
| All providers fail, stale cache exists | Stale cache entry is returned; `stale: true`, `source: "stale-cache"` |
| All providers fail, no cache exists | Static hardcoded rates are returned; `stale: true`, `source: "static-fallback"` |

**TTL:** 1 hour by default. Override with the `EXCHANGE_RATE_TTL_MS` environment variable (value in milliseconds).

The cache is **in-memory only** and is cleared on server restart. A restart with all providers unavailable will serve static fallback rates until at least one provider recovers.

---

## API Response Fields

`GET /api/exchange-rates?base=USD` returns:

```json
{
  "success": true,
  "data": {
    "base": "USD",
    "rates": { "EUR": 0.92, "GBP": 0.79, "XLM": 8.5, ... },
    "cachedAt": "2026-05-28T10:00:00.000Z",
    "stale": false,
    "source": "live"
  },
  "meta": { "timestamp": "2026-05-28T11:00:00.000Z" }
}
```

| Field | Type | Description |
|---|---|---|
| `cachedAt` | ISO timestamp | When the rates were last successfully fetched from a live provider |
| `stale` | boolean | `true` when rates did not come from a fresh live fetch |
| `source` | `"live"` \| `"stale-cache"` \| `"static-fallback"` | Identifies the data source |

---

## User-Facing Behaviour for Stale Data

When `stale: true` is returned:

- The client dashboard displays a `"(rates may be outdated)"` label next to converted amounts.
- Currency conversion still works — users see approximate values rather than no values.
- The label is shown regardless of whether the source is `stale-cache` or `static-fallback`.

**Static fallback rates** are approximate values hardcoded in `src/services/exchange-rate/static-rates.ts`. They are updated manually and should be reviewed periodically. They are a last resort only — under normal conditions, at least one live provider will be available.

---

## Adding a New Provider

1. Create a class in `src/services/exchange-rate/` implementing `ExchangeRateProvider`:
   ```ts
   export class MyProvider implements ExchangeRateProvider {
     getName(): string { return 'MyProvider'; }
     supportsCurrency(currency: string): boolean { ... }
     async getRates(baseCurrency: string): Promise<Record<string, number>> { ... }
   }
   ```
2. Add it to the provider array in `src/index.ts` at the desired fallback position.
3. Add unit tests in `tests/`.
4. Update this document.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `EXCHANGE_RATE_TTL_MS` | `3600000` (1 hour) | How long a cached result is considered fresh before re-fetching |
