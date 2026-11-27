import { SUPPORTED_FIAT } from '../../constants/currencies';
import logger from '../../config/logger';
import type { ExchangeRateProvider } from './types';
import { ExternalServiceClient } from '../../utils/external-service-client';

/**
 * Fallback fiat exchange-rate provider backed by the Frankfurter API
 * (https://www.frankfurter.app), which sources data from the European
 * Central Bank. Free, no API key required.
 *
 * Used as the secondary fiat provider when ExchangeRate-API is unavailable.
 */
export class FrankfurterProvider implements ExchangeRateProvider {
  private readonly baseUrl = 'https://api.frankfurter.app/latest';
  private readonly client = new ExternalServiceClient('exchange_rates');

  getName(): string {
    return 'Frankfurter';
  }

  supportsCurrency(currency: string): boolean {
    return (SUPPORTED_FIAT as readonly string[]).includes(currency);
  }

  async getRates(baseCurrency: string): Promise<Record<string, number>> {
    const url = `${this.baseUrl}?from=${baseCurrency}`;
    logger.debug(`Fetching fiat rates from Frankfurter: ${url}`);

    const data = await this.client.request<{
      base: string;
      rates: Record<string, number>;
    }>(url);

    // Frankfurter omits the base currency itself from the rates object.
    // Add it explicitly so callers get a complete rates map.
    return { [baseCurrency]: 1, ...data.rates };
  }
}
