import { SUPPORTED_FIAT } from '../../constants/currencies';
import logger from '../../config/logger';
import type { ExchangeRateProvider } from './types';

export class FiatRateProvider implements ExchangeRateProvider {
  private readonly baseUrl = 'https://api.exchangerate-api.com/v4/latest';

  getName(): string {
    return 'ExchangeRate-API';
  }

  supportsCurrency(currency: string): boolean {
    return (SUPPORTED_FIAT as readonly string[]).includes(currency);
  }

  async getRates(baseCurrency: string): Promise<Record<string, number>> {
    const url = `${this.baseUrl}/${baseCurrency}`;
    logger.debug(`Fetching fiat rates from ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fiat rate API returned status ${response.status}`);
    }

    const data = await response.json() as { rates: Record<string, number> };
    return data.rates;
  }
}
