export interface ExchangeRateProvider {
  getName(): string;
  getRates(baseCurrency: string): Promise<Record<string, number>>;
  supportsCurrency(currency: string): boolean;
}

export interface CachedRates {
  rates: Record<string, number>;
  fetchedAt: number;
}

export interface ExchangeRateResponse {
  base: string;
  rates: Record<string, number>;
  /**
   * ISO timestamp of when the rates were last successfully fetched from a live
   * provider, or `null` when no live fetch has ever succeeded (static fallback).
   */
  cachedAt: string | null;
  /**
   * Age of the returned rates in milliseconds (time since the last successful
   * live fetch), or `null` when no live fetch has ever succeeded. Consumers can
   * use this to decide whether a staleness warning should be shown.
   */
  ageMs: number | null;
  /**
   * True when the returned rates did not come from a fresh live fetch.
   * This happens when:
   *   - All providers failed and a previously-cached (but now expired) entry was returned, OR
   *   - All providers failed and no cache existed, so static hardcoded rates were used.
   * Consumers should surface this to the user so they know the rates may be outdated.
   */
  stale: boolean;
  /** Identifies the data source that produced these rates. */
  source: 'live' | 'stale-cache' | 'static-fallback';
}
