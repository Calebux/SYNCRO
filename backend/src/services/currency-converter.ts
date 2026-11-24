import logger from '../config/logger';
import { ExchangeRateService } from './exchange-rate/exchange-rate-service';
import { FiatRateProvider } from './exchange-rate/fiat-provider';
import { FrankfurterProvider } from './exchange-rate/frankfurter-provider';
import { CryptoRateProvider } from './exchange-rate/crypto-provider';
import { roundMoney } from '@syncro/shared/subscription-math';

export class CurrencyConverter {
  private readonly exchangeRateService: ExchangeRateService;
  private dailyCache = new Map<string, Record<string, number>>();

  constructor(exchangeRateService?: ExchangeRateService) {
    this.exchangeRateService = exchangeRateService ?? new ExchangeRateService([
      new FiatRateProvider(),
      new FrankfurterProvider(),
      new CryptoRateProvider(),
    ]);
  }

  /**
   * Convert `amount` from `fromCurrency` to `toCurrency`.
   * Rates are cached per calendar day so repeated conversions reuse the
   * same rate matrix without hitting providers again.
   */
  async convert(amount: number, fromCurrency: string, toCurrency: string): Promise<number> {
    if (fromCurrency === toCurrency) return roundMoney(amount);

    const today = this.getDateKey();
    const cacheKey = `${fromCurrency}:${toCurrency}:${today}`;

    let rates = this.dailyCache.get(cacheKey);
    if (!rates) {
      try {
        rates = await this.exchangeRateService.getRates('USD');
        this.dailyCache.set(cacheKey, rates);
      } catch (error) {
        logger.warn('CurrencyConverter: failed to fetch rates, returning original amount', { error });
        return roundMoney(amount);
      }
    }

    const fromRate = fromCurrency === 'USD' ? 1 : rates[fromCurrency];
    const toRate = toCurrency === 'USD' ? 1 : rates[toCurrency];

    if (!fromRate || !toRate) {
      logger.warn('CurrencyConverter: missing rate for conversion', { fromCurrency, toCurrency });
      return roundMoney(amount);
    }

    return roundMoney((amount / fromRate) * toRate);
  }

  /**
   * Convert an array of normalized monthly amounts to `targetCurrency`.
   * Each item is in its native currency.
   */
  async convertMonthlyAmounts(
    items: Array<{ monthlyAmount: number; currency: string }>,
    targetCurrency: string,
  ): Promise<number> {
    const conversions = items.map((item) =>
      this.convert(item.monthlyAmount, item.currency, targetCurrency),
    );
    const totals = await Promise.all(conversions);
    return roundMoney(totals.reduce((sum, val) => sum + val, 0));
  }

  /**
   * Clear the daily cache. Useful for testing or manual invalidation.
   */
  clearCache(): void {
    this.dailyCache.clear();
  }

  private getDateKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
}
