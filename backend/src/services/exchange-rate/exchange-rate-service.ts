import logger from '../../config/logger';
import { STATIC_RATES_USD } from './static-rates';
import type { ExchangeRateProvider, CachedRates, ExchangeRateResponse } from './types';

export class ExchangeRateService {
  private cache = new Map<string, CachedRates>();
  private readonly TTL = 3600000; // 1 hour
  private providers: ExchangeRateProvider[];

  constructor(providers: ExchangeRateProvider[]) {
    this.providers = providers;
  }

  async getRates(baseCurrency: string): Promise<Record<string, number>> {
    const cached = this.cache.get(baseCurrency);
    if (cached && Date.now() - cached.fetchedAt < this.TTL) {
      return cached.rates;
    }

    try {
      const allRates = await this.fetchFromProviders(baseCurrency);
      this.cache.set(baseCurrency, { rates: allRates, fetchedAt: Date.now() });
      return allRates;
    } catch (error) {
      logger.error('All exchange rate providers failed', { baseCurrency, error });

      // Fallback 1: stale cache
      if (cached) {
        logger.warn('Returning stale cached rates', { baseCurrency });
        return cached.rates;
      }

      // Fallback 2: static rates (only works for USD base)
      logger.warn('Returning static fallback rates');
      if (baseCurrency === 'USD') {
        return { ...STATIC_RATES_USD };
      }

      // Cross-convert static rates from USD to requested base
      const usdToBase = STATIC_RATES_USD[baseCurrency];
      if (usdToBase) {
        const rates: Record<string, number> = {};
        for (const [currency, usdRate] of Object.entries(STATIC_RATES_USD)) {
          rates[currency] = usdRate / usdToBase;
        }
        return rates;
      }

      return { ...STATIC_RATES_USD };
    }
  }

  async getRate(from: string, to: string): Promise<number> {
    if (from === to) return 1;

    // Always fetch USD-based rates and cross-convert
    const rates = await this.getRates('USD');
    const fromRate = from === 'USD' ? 1 : rates[from];
    const toRate = to === 'USD' ? 1 : rates[to];

    if (!fromRate || !toRate) {
      throw new Error(`Cannot convert between ${from} and ${to}: missing rate`);
    }

    return toRate / fromRate;
  }

  async convert(amount: number, from: string, to: string): Promise<number> {
    const rate = await this.getRate(from, to);
    return amount * rate;
  }

  async getExchangeRateResponse(baseCurrency: string): Promise<ExchangeRateResponse> {
    const cached = this.cache.get(baseCurrency);
    const isFresh = cached && Date.now() - cached.fetchedAt < this.TTL;

    const rates = await this.getRates(baseCurrency);
    const currentCached = this.cache.get(baseCurrency);

    return {
      base: baseCurrency,
      rates,
      cachedAt: currentCached
        ? new Date(currentCached.fetchedAt).toISOString()
        : new Date().toISOString(),
      stale: !isFresh && !!cached,
    };
  }

  /** Test helper: expire cache entry to simulate TTL expiry */
  expireCacheForTesting(baseCurrency: string): void {
    const cached = this.cache.get(baseCurrency);
    if (cached) {
      cached.fetchedAt = 0;
    }
  }

  private async fetchFromProviders(baseCurrency: string): Promise<Record<string, number>> {
    const allRates: Record<string, number> = {};
    const errors: Error[] = [];

    for (const provider of this.providers) {
      try {
        const rates = await provider.getRates(baseCurrency);
        Object.assign(allRates, rates);
      } catch (error) {
        logger.warn(`Provider ${provider.getName()} failed`, { error });
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (Object.keys(allRates).length === 0) {
      throw new AggregateError(errors, 'All providers failed');
    }

    return allRates;
  }
}
