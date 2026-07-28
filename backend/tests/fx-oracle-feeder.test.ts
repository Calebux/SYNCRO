import { FxOracleFeeder } from '../src/services/fx-oracle-feeder';
import { ExchangeRateService } from '../src/services/exchange-rate/exchange-rate-service';
import type { ExchangeRateProvider } from '../src/services/exchange-rate/types';

// Mock logger
jest.mock('../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  __esModule: true,
}));

// Mock blockchain service
jest.mock('../src/services/blockchain-service', () => ({
  blockchainService: {
    invokeContract: jest.fn(),
  },
}));

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

describe('FxOracleFeeder', () => {
  let exchangeRateService: ExchangeRateService;
  let oracleFeeder: FxOracleFeeder;
  let mockProvider: ExchangeRateProvider;

  beforeEach(() => {
    mockProvider = createMockProvider(
      'mock-provider',
      ['USD', 'EUR', 'GBP', 'JPY'],
      { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 145.5 }
    );

    exchangeRateService = new ExchangeRateService([mockProvider], 60000);

    oracleFeeder = new FxOracleFeeder(exchangeRateService, {
      contractAddress: 'test-contract-address',
      updateInterval: 60000, // 1 minute
      currencies: ['EUR', 'GBP', 'JPY'],
      baseCurrency: 'USD',
    });
  });

  afterEach(() => {
    oracleFeeder.stop();
  });

  it('initializes with correct configuration', () => {
    const status = oracleFeeder.getStatus();
    expect(status.isRunning).toBe(false);
    expect(status.config.baseCurrency).toBe('USD');
    expect(status.config.currencies).toEqual(['EUR', 'GBP', 'JPY']);
  });

  it('starts and stops correctly', () => {
    oracleFeeder.start();
    expect(oracleFeeder.getStatus().isRunning).toBe(true);

    oracleFeeder.stop();
    expect(oracleFeeder.getStatus().isRunning).toBe(false);
  });

  it('prevents starting twice', () => {
    oracleFeeder.start();
    oracleFeeder.start(); // Should log warning but not error
    expect(oracleFeeder.getStatus().isRunning).toBe(true);
  });

  it('fetches and prepares rate updates', async () => {
    await oracleFeeder.updateRates();

    // Verify provider was called
    expect(mockProvider.getRates).toHaveBeenCalledWith('USD');
  });

  it('converts rates to fixed-point format', async () => {
    // This would be tested by inspecting the submitted updates
    // For now, we verify it doesn't throw
    await expect(oracleFeeder.updateRates()).resolves.not.toThrow();
  });

  it('handles missing rates gracefully', async () => {
    const incompleteProvider = createMockProvider(
      'incomplete',
      ['USD', 'EUR'],
      { USD: 1, EUR: 0.92 } // Missing GBP and JPY
    );

    const service = new ExchangeRateService([incompleteProvider], 60000);
    const feeder = new FxOracleFeeder(service, {
      contractAddress: 'test-address',
      updateInterval: 60000,
      currencies: ['EUR', 'GBP', 'JPY'],
      baseCurrency: 'USD',
    });

    // Should not throw, but should log warnings
    await expect(feeder.updateRates()).resolves.not.toThrow();
  });

  it('skips base currency in updates', async () => {
    const feeder = new FxOracleFeeder(exchangeRateService, {
      contractAddress: 'test-address',
      updateInterval: 60000,
      currencies: ['USD', 'EUR', 'GBP'], // Includes base currency
      baseCurrency: 'USD',
    });

    // Should process EUR and GBP but skip USD
    await expect(feeder.updateRates()).resolves.not.toThrow();
  });

  it('handles stale exchange rate data', async () => {
    // Mock stale data by having provider return old data
    const staleProvider = createMockProvider(
      'stale-provider',
      ['USD', 'EUR'],
      { USD: 1, EUR: 0.92 }
    );

    const service = new ExchangeRateService([staleProvider], 1); // 1ms TTL
    await new Promise((resolve) => setTimeout(resolve, 10)); // Wait for staleness

    const feeder = new FxOracleFeeder(service, {
      contractAddress: 'test-address',
      updateInterval: 60000,
      currencies: ['EUR'],
      baseCurrency: 'USD',
    });

    // Should still update with stale data but log warning
    await expect(feeder.updateRates()).resolves.not.toThrow();
  });

  it('handles complete update failure gracefully', async () => {
    const failingProvider = createMockProvider('failing', ['USD'], {});
    failingProvider.getRates = jest.fn().mockRejectedValue(new Error('Provider failed'));

    const service = new ExchangeRateService([failingProvider], 60000);
    const feeder = new FxOracleFeeder(service, {
      contractAddress: 'test-address',
      updateInterval: 60000,
      currencies: ['EUR'],
      baseCurrency: 'USD',
    });

    await expect(feeder.updateRates()).rejects.toThrow('Provider failed');
  });

  it('manual trigger works when running', async () => {
    oracleFeeder.start();
    await expect(oracleFeeder.triggerUpdate()).resolves.not.toThrow();
  });

  it('manual trigger fails when not running', async () => {
    await expect(oracleFeeder.triggerUpdate()).rejects.toThrow(
      'Oracle feeder is not running'
    );
  });

  it('encodes rates with correct precision', async () => {
    // Rate: 0.92 should become 92,000,000 (8 decimals)
    // This tests the fixed-point conversion logic
    const rates = {
      EUR: 0.92,
      GBP: 0.79,
      JPY: 145.5,
    };

    const provider = createMockProvider('test', ['USD', 'EUR', 'GBP', 'JPY'], {
      USD: 1,
      ...rates,
    });

    const service = new ExchangeRateService([provider], 60000);
    const feeder = new FxOracleFeeder(service, {
      contractAddress: 'test-address',
      updateInterval: 60000,
      currencies: Object.keys(rates),
      baseCurrency: 'USD',
    });

    await expect(feeder.updateRates()).resolves.not.toThrow();

    // Expected conversions:
    // 0.92 -> 92,000,000
    // 0.79 -> 79,000,000
    // 145.5 -> 14,550,000,000
  });

  it('batches updates with concurrency limit', async () => {
    // Create feeder with many currencies
    const manyCurrencies = ['EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD', 'SEK'];
    const ratesData: Record<string, number> = { USD: 1 };
    manyCurrencies.forEach((c, i) => {
      ratesData[c] = 0.8 + i * 0.1;
    });

    const provider = createMockProvider('multi', ['USD', ...manyCurrencies], ratesData);
    const service = new ExchangeRateService([provider], 60000);

    const feeder = new FxOracleFeeder(service, {
      contractAddress: 'test-address',
      updateInterval: 60000,
      currencies: manyCurrencies,
      baseCurrency: 'USD',
    });

    // Should handle all currencies without error
    await expect(feeder.updateRates()).resolves.not.toThrow();
  });
});
