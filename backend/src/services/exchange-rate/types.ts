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
  cachedAt: string;
  stale: boolean;
}
