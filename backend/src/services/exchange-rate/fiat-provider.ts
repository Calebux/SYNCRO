import { SUPPORTED_FIAT } from '../../constants/currencies';
import logger from '../../config/logger';
import type { ExchangeRateProvider } from './types';
import { ExternalServiceClient } from '../../utils/external-service-client';

export class FiatRateProvider implements ExchangeRateProvider {
  private readonly baseUrl = 'https://api.exchangerate-api.com/v4/latest';
  private readonly client = new ExternalServiceClient('exchange_rates');

  getName(): string {
    return 'ExchangeRate-API';
  }

  supportsCurrency(currency: string): boolean {
    return (SUPPORTED_FIAT as readonly string[]).includes(currency);
  }

  async getRates(baseCurrency: string): Promise<Record<string, number>> {
    const url = `${this.baseUrl}/${baseCurrency}`;
    logger.debug(`Fetching fiat rates from ${url}`);

    const data = await this.client.request<{ rates: Record<string, number> }>(url);
    return data.rates;
  }
}
