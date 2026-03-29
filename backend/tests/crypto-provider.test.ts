import { CryptoRateProvider } from '../src/services/exchange-rate/crypto-provider';

// Mock logger
jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('CryptoRateProvider', () => {
  const provider = new CryptoRateProvider();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns XLM and USDC rates from CoinGecko', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stellar: { usd: 0.12, eur: 0.11 },
        'usd-coin': { usd: 1.0, eur: 0.92 },
      }),
    });

    const rates = await provider.getRates('USD');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.coingecko.com')
    );
    // XLM rate = how many XLM per 1 USD = 1 / 0.12
    expect(rates.XLM).toBeCloseTo(1 / 0.12, 2);
    expect(rates.USDC).toBeCloseTo(1 / 1.0, 2);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(provider.getRates('USD')).rejects.toThrow('Crypto rate API returned status 429');
  });

  it('supports crypto currencies only', () => {
    expect(provider.supportsCurrency('XLM')).toBe(true);
    expect(provider.supportsCurrency('USDC')).toBe(true);
    expect(provider.supportsCurrency('USD')).toBe(false);
  });
});
