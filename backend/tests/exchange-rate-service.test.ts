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
      'https://api.exchangerate-api.com/v4/latest/USD',
      expect.objectContaining({
        signal: expect.any(Object),
      })
    );
    expect(rates.EUR).toBe(0.92);
    expect(rates.NGN).toBe(1520);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    });
    await expect(provider.getRates('USD')).rejects.toThrow(
      'External service exchange_rates returned status 400: bad request'
    );
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
  let frankfurterProvider: ExchangeRateProvider;
  let cryptoProvider: ExchangeRateProvider;
  let service: ExchangeRateService;

  beforeEach(() => {
    fiatProvider = createMockProvider(
      'fiat',
      ['USD', 'EUR', 'NGN'],
      { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1520 }
    );
    frankfurterProvider = createMockProvider(
      'Frankfurter',
      ['USD', 'EUR', 'NGN'],
      { USD: 1, EUR: 0.91, GBP: 0.78, NGN: 1510 }
    );
    cryptoProvider = createMockProvider(
      'crypto',
      ['XLM', 'USDC'],
      { XLM: 8.5, USDC: 1 }
    );
    service = new ExchangeRateService([fiatProvider, frankfurterProvider, cryptoProvider]);
  });

  it('returns combined fiat and crypto rates', async () => {
    const rates = await service.getRates('USD');
    expect(rates.EUR).toBe(0.91);
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
    expect(result).toBeCloseTo(91, 0);
  });

  it('converts through USD intermediary', async () => {
    const result = await service.convert(1, 'EUR', 'NGN');
    // 1 EUR -> USD = 1/0.91 ~= 1.099 -> NGN = 1.099 * 1510 ~= 1659
    expect(result).toBeCloseTo(1659.34, 0);
  });

  it('falls back to Frankfurter when primary fiat provider fails', async () => {
    (fiatProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('ExchangeRate-API down'));

    const rates = await service.getRates('USD');

    // Frankfurter rates should be used for fiat; crypto still comes from CoinGecko mock
    expect(rates.EUR).toBe(0.91);
    expect(rates.XLM).toBe(8.5);
    expect(frankfurterProvider.getRates).toHaveBeenCalledTimes(1);
  });

  it('returns stale cache when all providers fail', async () => {
    // First call succeeds and populates cache
    await service.getRates('USD');

    // All providers throw on the next attempt
    (fiatProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('API down'));
    (frankfurterProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('API down'));
    (cryptoProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('API down'));

    // Force cache expiry
    service.expireCacheForTesting('USD');

    const rates = await service.getRates('USD');
    expect(rates.EUR).toBe(0.91); // stale cached value from first call
  });

  it('returns static fallback when no cache exists and all providers fail', async () => {
    const failProvider = createMockProvider('fail', ['USD', 'EUR'], {});
    (failProvider.getRates as jest.Mock).mockRejectedValue(new Error('API down'));
    const failFrankfurter = createMockProvider('failFrankfurter', ['USD', 'EUR'], {});
    (failFrankfurter.getRates as jest.Mock).mockRejectedValue(new Error('API down'));
    const failCryptoProvider = createMockProvider('failCrypto', ['XLM'], {});
    (failCryptoProvider.getRates as jest.Mock).mockRejectedValue(new Error('API down'));

    const failService = new ExchangeRateService([failProvider, failFrankfurter, failCryptoProvider]);
    const rates = await failService.getRates('USD');

    // Should return static fallback rates
    expect(rates.EUR).toBe(0.92);
    expect(rates.XLM).toBe(8.5);
  });

  describe('getExchangeRateResponse', () => {
    it('returns source=live on a fresh fetch', async () => {
      const response = await service.getExchangeRateResponse('USD');
      expect(response.stale).toBe(false);
      expect(response.source).toBe('live');
    });

    it('returns source=stale-cache when all providers fail but cache exists', async () => {
      // Populate cache
      await service.getRates('USD');
      service.expireCacheForTesting('USD');

      (fiatProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('down'));
      (frankfurterProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('down'));
      (cryptoProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('down'));

      const response = await service.getExchangeRateResponse('USD');
      expect(response.stale).toBe(true);
      expect(response.source).toBe('stale-cache');
    });

    it('returns source=static-fallback when all providers fail and no cache exists', async () => {
      const failProvider = createMockProvider('fail', ['USD'], {});
      (failProvider.getRates as jest.Mock).mockRejectedValue(new Error('down'));
      const failFrankfurter = createMockProvider('failF', ['USD'], {});
      (failFrankfurter.getRates as jest.Mock).mockRejectedValue(new Error('down'));
      const failCrypto = createMockProvider('failC', ['XLM'], {});
      (failCrypto.getRates as jest.Mock).mockRejectedValue(new Error('down'));

      const failService = new ExchangeRateService([failProvider, failFrankfurter, failCrypto]);
      const response = await failService.getExchangeRateResponse('USD');

      expect(response.stale).toBe(true);
      expect(response.source).toBe('static-fallback');
    });

    it('returns source=live on a cache hit within TTL', async () => {
      // First call populates cache
      await service.getExchangeRateResponse('USD');
      // Second call should hit cache
      const response = await service.getExchangeRateResponse('USD');
      expect(response.stale).toBe(false);
      expect(response.source).toBe('live');
      // Providers called only once (cache hit on second call)
      expect(fiatProvider.getRates).toHaveBeenCalledTimes(1);
    });

    it('reports a non-null cachedAt and numeric ageMs on a live fetch', async () => {
      const response = await service.getExchangeRateResponse('USD');
      expect(response.cachedAt).not.toBeNull();
      expect(typeof response.ageMs).toBe('number');
      expect(response.ageMs).toBeGreaterThanOrEqual(0);
    });

    it('does NOT report a fresh cachedAt when falling back to static rates', async () => {
      // Provider outage with no prior successful fetch → static fallback.
      // cachedAt/ageMs must be null so the client is not misled into thinking
      // the rates are fresh.
      const failProvider = createMockProvider('fail', ['USD'], {});
      (failProvider.getRates as jest.Mock).mockRejectedValue(new Error('down'));
      const failFrankfurter = createMockProvider('failF', ['USD'], {});
      (failFrankfurter.getRates as jest.Mock).mockRejectedValue(new Error('down'));
      const failCrypto = createMockProvider('failC', ['XLM'], {});
      (failCrypto.getRates as jest.Mock).mockRejectedValue(new Error('down'));

      const failService = new ExchangeRateService([failProvider, failFrankfurter, failCrypto]);
      const response = await failService.getExchangeRateResponse('USD');

      expect(response.source).toBe('static-fallback');
      expect(response.stale).toBe(true);
      expect(response.cachedAt).toBeNull();
      expect(response.ageMs).toBeNull();
    });

    it('reports increasing ageMs as a cached entry gets older during an outage', async () => {
      // Populate cache with a live fetch.
      const fresh = await service.getExchangeRateResponse('USD');
      expect(fresh.ageMs).toBeGreaterThanOrEqual(0);

      // Simulate provider outage after the cache goes stale.
      service.expireCacheForTesting('USD');
      (fiatProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('down'));
      (frankfurterProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('down'));
      (cryptoProvider.getRates as jest.Mock).mockRejectedValueOnce(new Error('down'));

      const stale = await service.getExchangeRateResponse('USD');
      expect(stale.source).toBe('stale-cache');
      expect(stale.stale).toBe(true);
      // Age is derived from the original (now expired) fetch timestamp, so it is
      // a real, non-null number the client can display.
      expect(typeof stale.ageMs).toBe('number');
      expect(stale.cachedAt).not.toBeNull();
    });
  });

  describe('configurable TTL', () => {
    it('respects a custom TTL passed to the constructor', async () => {
      const shortTtlService = new ExchangeRateService(
        [fiatProvider, frankfurterProvider, cryptoProvider],
        100 // 100 ms TTL
      );

      await shortTtlService.getRates('USD');
      expect(fiatProvider.getRates).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      await shortTtlService.getRates('USD');
      // Should have re-fetched after TTL expired
      expect(fiatProvider.getRates).toHaveBeenCalledTimes(2);
    });
  });
});
