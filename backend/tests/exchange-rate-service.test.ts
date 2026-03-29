import { FiatRateProvider } from '../src/services/exchange-rate/fiat-provider';

// Mock logger
jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('FiatRateProvider', () => {
  const provider = new FiatRateProvider();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns rates from ExchangeRate-API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        base: 'USD',
        rates: { EUR: 0.92, GBP: 0.79, NGN: 1520 },
      }),
    });

    const rates = await provider.getRates('USD');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.exchangerate-api.com/v4/latest/USD'
    );
    expect(rates.EUR).toBe(0.92);
    expect(rates.NGN).toBe(1520);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(provider.getRates('USD')).rejects.toThrow('Fiat rate API returned status 500');
  });

  it('supports fiat currencies', () => {
    expect(provider.supportsCurrency('USD')).toBe(true);
    expect(provider.supportsCurrency('NGN')).toBe(true);
    expect(provider.supportsCurrency('XLM')).toBe(false);
  });
});

import { ExchangeRateService } from '../src/services/exchange-rate/exchange-rate-service';
import type { ExchangeRateProvider } from '../src/services/exchange-rate/types';

function createMockProvider(
  name: string,
  currencies: string[],
  rates: Record<string, number>
): ExchangeRateProvider {
  return {
    getName: () => name,
    supportsCurrency: (c) => currencies.includes(c),
    getRates: jest.fn().mockResolvedValue(rates),
  };
}

describe('ExchangeRateService', () => {
  let fiatProvider: ExchangeRateProvider;
  let cryptoProvider: ExchangeRateProvider;
  let service: ExchangeRateService;

  beforeEach(() => {
    fiatProvider = createMockProvider(
      'fiat',
      ['USD', 'EUR', 'NGN'],
      { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1520 }
    );
    cryptoProvider = createMockProvider(
      'crypto',
      ['XLM', 'USDC'],
      { XLM: 8.5, USDC: 1 }
    );
    service = new ExchangeRateService([fiatProvider, cryptoProvider]);
  });

  it('returns combined fiat and crypto rates', async () => {
    const rates = await service.getRates('USD');
    expect(rates.EUR).toBe(0.92);
    expect(rates.XLM).toBe(8.5);
  });

  it('caches rates within TTL', async () => {
    await service.getRates('USD');
    await service.getRates('USD');

    expect(fiatProvider.getRates).toHaveBeenCalledTimes(1);
    expect(cryptoProvider.getRates).toHaveBeenCalledTimes(1);
  });

  it('converts between two currencies', async () => {
    const result = await service.convert(100, 'USD', 'EUR');
    expect(result).toBeCloseTo(92, 0);
  });

  it('converts through USD intermediary', async () => {
    const result = await service.convert(1, 'EUR', 'NGN');
    // 1 EUR -> USD = 1/0.92 ~= 1.087 -> NGN = 1.087 * 1520 ~= 1652
    expect(result).toBeCloseTo(1652.17, 0);
  });

  it('returns stale cache when provider fails', async () => {
    // First call succeeds and populates cache
    await service.getRates('USD');

    // Second call: provider throws
    (fiatProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('API down'));
    (cryptoProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('API down'));

    // Force cache expiry by manipulating internal state
    service.expireCacheForTesting('USD');

    const rates = await service.getRates('USD');
    expect(rates.EUR).toBe(0.92); // stale cached value
  });

  it('returns static fallback when no cache exists and provider fails', async () => {
    const failProvider = createMockProvider('fail', ['USD', 'EUR'], {});
    (failProvider.getRates as jest.Mock).mockRejectedValue(new Error('API down'));
    const failCryptoProvider = createMockProvider('failCrypto', ['XLM'], {});
    (failCryptoProvider.getRates as jest.Mock).mockRejectedValue(new Error('API down'));

    const failService = new ExchangeRateService([failProvider, failCryptoProvider]);
    const rates = await failService.getRates('USD');

    // Should return static fallback rates
    expect(rates.EUR).toBe(0.92);
    expect(rates.XLM).toBe(8.5);
  });
});
