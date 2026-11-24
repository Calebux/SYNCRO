import { FrankfurterProvider } from '../src/services/exchange-rate/frankfurter-provider';

jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('FrankfurterProvider', () => {
  const provider = new FrankfurterProvider();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns rates from Frankfurter API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        base: 'USD',
        // Frankfurter omits the base currency from its response
        rates: { EUR: 0.92, GBP: 0.79, NGN: 1520 },
      }),
    });

    const rates = await provider.getRates('USD');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.frankfurter.app/latest?from=USD'
    );
    expect(rates.EUR).toBe(0.92);
    expect(rates.NGN).toBe(1520);
    // Base currency should be injected with rate 1
    expect(rates.USD).toBe(1);
  });

  it('injects the base currency with rate 1 for non-USD bases', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        base: 'EUR',
        rates: { USD: 1.09, GBP: 0.86 },
      }),
    });

    const rates = await provider.getRates('EUR');
    expect(rates.EUR).toBe(1);
    expect(rates.USD).toBe(1.09);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(provider.getRates('USD')).rejects.toThrow(
      'Frankfurter API returned status 503'
    );
  });

  it('supports fiat currencies', () => {
    expect(provider.supportsCurrency('USD')).toBe(true);
    expect(provider.supportsCurrency('EUR')).toBe(true);
    expect(provider.supportsCurrency('NGN')).toBe(true);
    expect(provider.supportsCurrency('XLM')).toBe(false);
    expect(provider.supportsCurrency('USDC')).toBe(false);
  });

  it('getName returns Frankfurter', () => {
    expect(provider.getName()).toBe('Frankfurter');
  });
});
