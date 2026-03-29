import { SUPPORTED_CRYPTO } from '../../constants/currencies';
import logger from '../../config/logger';
import type { ExchangeRateProvider } from './types';

const COINGECKO_IDS: Record<string, string> = {
  XLM: 'stellar',
  USDC: 'usd-coin',
};

const COINGECKO_VS_MAP: Record<string, string> = {
  USD: 'usd', EUR: 'eur', GBP: 'gbp', CAD: 'cad', AUD: 'aud',
  JPY: 'jpy', NGN: 'ngn', GHS: 'ghs', KES: 'kes', ZAR: 'zar',
};

export class CryptoRateProvider implements ExchangeRateProvider {
  private readonly baseUrl = 'https://api.coingecko.com/api/v3/simple/price';

  getName(): string {
    return 'CoinGecko';
  }

  supportsCurrency(currency: string): boolean {
    return (SUPPORTED_CRYPTO as readonly string[]).includes(currency);
  }

  async getRates(baseCurrency: string): Promise<Record<string, number>> {
    const vsKey = COINGECKO_VS_MAP[baseCurrency];
    if (!vsKey) {
      throw new Error(`CoinGecko does not support base currency: ${baseCurrency}`);
    }

    const ids = Object.values(COINGECKO_IDS).join(',');
    const url = `${this.baseUrl}?ids=${ids}&vs_currencies=${vsKey}`;
    logger.debug(`Fetching crypto rates from ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Crypto rate API returned status ${response.status}`);
    }

    const data = (await response.json()) as Record<string, Record<string, number>>;
    const rates: Record<string, number> = {};

    // Convert "price of 1 XLM in USD" to "how many XLM per 1 USD"
    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      const priceInBase = data[geckoId]?.[vsKey];
      if (priceInBase && priceInBase > 0) {
        rates[symbol] = 1 / priceInBase;
      }
    }

    return rates;
  }
}
