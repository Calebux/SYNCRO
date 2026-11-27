/**
 * Issue #972 – Multi-currency display: exchange rate matrix with caching
 *
 * Provides:
 * - A cached exchange rate matrix (sessionStorage TTL = 1 hour)
 * - Conversion helpers
 * - Static fallback rates for offline / API-failure scenarios
 */

import type { Currency } from "@/lib/currency-utils"

// ── Types ──────────────────────────────────────────────────────────────────────

/** ISO 4217 rate relative to USD base (1 USD = N units of the currency). */
export type ExchangeRateMap = Record<string, number>

export interface ExchangeRateCache {
  rates: ExchangeRateMap
  fetchedAt: number // Unix timestamp (ms)
}

// ── Static fallback rates (USD base) ──────────────────────────────────────────
// Updated periodically; serve as a safe offline fallback only.
const FALLBACK_RATES: ExchangeRateMap = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
  CAD: 1.36,
  AUD: 1.53,
  NGN: 1580,
  GHS: 15.2,
  KES: 129,
  ZAR: 18.7,
  XLM: 10.5,
  USDC: 1,
}

// ── Cache helpers ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "syncro:exchange_rates"
const TTL_MS = 60 * 60 * 1000 // 1 hour

function readCache(): ExchangeRateCache | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ExchangeRateCache
  } catch {
    return null
  }
}

function writeCache(rates: ExchangeRateMap): void {
  if (typeof window === "undefined") return
  try {
    const cache: ExchangeRateCache = { rates, fetchedAt: Date.now() }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // sessionStorage unavailable — silently ignore.
  }
}

function isCacheValid(cache: ExchangeRateCache): boolean {
  return Date.now() - cache.fetchedAt < TTL_MS
}

// ── Rate fetching ──────────────────────────────────────────────────────────────

/**
 * Fetch live exchange rates. Uses the public exchangerate-api endpoint (no key
 * required for the free tier). Returns the fallback map on network failure.
 *
 * Results are cached in sessionStorage for `TTL_MS` milliseconds.
 */
export async function fetchExchangeRates(): Promise<ExchangeRateMap> {
  // Return cached rates if fresh.
  const cached = readCache()
  if (cached && isCacheValid(cached)) {
    return cached.rates
  }

  try {
    const res = await fetch(
      "https://open.er-api.com/v6/latest/USD",
      { signal: AbortSignal.timeout(5000) },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { rates?: Record<string, number> }
    const rates: ExchangeRateMap = data.rates ?? FALLBACK_RATES
    writeCache(rates)
    return rates
  } catch {
    // Network failure — return stale cache if available, otherwise fallback.
    if (cached) return cached.rates
    return FALLBACK_RATES
  }
}

/**
 * Synchronously return the best available rates without triggering a fetch.
 * Useful for rendering — call `fetchExchangeRates()` separately to keep
 * them fresh.
 */
export function getCachedRates(): ExchangeRateMap {
  const cached = readCache()
  return cached?.rates ?? FALLBACK_RATES
}

// ── Conversion helpers ─────────────────────────────────────────────────────────

/**
 * Convert `amount` from `from` currency to `to` currency using the supplied
 * rate map (USD-based). Returns the original amount if either currency is
 * missing from the map.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: ExchangeRateMap,
): number {
  if (from === to) return amount
  const fromRate = from.toUpperCase() === "USD" ? 1 : rates[from.toUpperCase()]
  const toRate = to.toUpperCase() === "USD" ? 1 : rates[to.toUpperCase()]
  if (!fromRate || !toRate) return amount
  // via USD
  return (amount / fromRate) * toRate
}

// ── Supported display currencies (Issue #972 requirement) ─────────────────────

export const DISPLAY_CURRENCIES: Currency[] = [
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "XLM",
]
