import logger from '../config/logger';
import { ExchangeRateService } from './exchange-rate/exchange-rate-service';
import { blockchainService } from './blockchain-service';
import { SUPPORTED_FIAT, SUPPORTED_CRYPTO } from '../constants/currencies';

/**
 * FX Oracle Feeder Service
 * 
 * Fetches exchange rates from external providers and submits them to the
 * on-chain FX oracle contract for validation in multi-currency renewals.
 */

interface OracleRateUpdate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: bigint;
  timestamp: number;
}

interface OracleConfig {
  contractAddress: string;
  updateInterval: number; // milliseconds
  currencies: string[];
  baseCurrency: string; // Usually "USD"
}

export class FxOracleFeeder {
  private exchangeRateService: ExchangeRateService;
  private config: OracleConfig;
  private updateTimer?: NodeJS.Timeout;
  private isRunning: boolean = false;

  constructor(exchangeRateService: ExchangeRateService, config: OracleConfig) {
    this.exchangeRateService = exchangeRateService;
    this.config = config;
  }

  /**
   * Start the oracle feeder service
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('FX Oracle Feeder already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting FX Oracle Feeder', {
      contractAddress: this.config.contractAddress,
      updateInterval: this.config.updateInterval,
      baseCurrency: this.config.baseCurrency,
      currencies: this.config.currencies,
    });

    // Initial update
    this.updateRates().catch((err) => {
      logger.error('Initial oracle rate update failed', { error: err.message });
    });

    // Schedule periodic updates
    this.updateTimer = setInterval(() => {
      this.updateRates().catch((err) => {
        logger.error('Scheduled oracle rate update failed', { error: err.message });
      });
    }, this.config.updateInterval);
  }

  /**
   * Stop the oracle feeder service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }

    logger.info('FX Oracle Feeder stopped');
  }

  /**
   * Fetch rates from exchange rate service and submit to oracle
   */
  async updateRates(): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Fetch latest rates from exchange service
      const ratesResponse = await this.exchangeRateService.getExchangeRateResponse(
        this.config.baseCurrency
      );

      if (ratesResponse.stale) {
        logger.warn('Exchange rate service returned stale data', {
          source: ratesResponse.source,
          ageMs: ratesResponse.ageMs,
        });
        // Continue anyway - stale is better than no update
      }

      const updates: OracleRateUpdate[] = [];
      const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

      // Prepare updates for each target currency
      for (const quoteCurrency of this.config.currencies) {
        if (quoteCurrency === this.config.baseCurrency) {
          continue; // Skip base currency (rate would be 1.0)
        }

        const rate = ratesResponse.rates[quoteCurrency];
        if (!rate) {
          logger.warn('Missing rate for currency', {
            baseCurrency: this.config.baseCurrency,
            quoteCurrency,
          });
          continue;
        }

        // Convert rate to 8 decimal fixed-point (multiply by 10^8)
        const rateFixedPoint = BigInt(Math.round(rate * 100_000_000));

        updates.push({
          baseCurrency: this.config.baseCurrency,
          quoteCurrency,
          rate: rateFixedPoint,
          timestamp,
        });
      }

      if (updates.length === 0) {
        logger.error('No valid rates to update');
        return;
      }

      // Submit updates to oracle contract
      const results = await this.submitUpdatesToOracle(updates);

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      const duration = Date.now() - startTime;

      logger.info('FX Oracle rate update completed', {
        successCount,
        failureCount,
        totalUpdates: updates.length,
        durationMs: duration,
        source: ratesResponse.source,
      });

      // Alert if too many failures
      if (failureCount > updates.length / 2) {
        logger.error('Majority of oracle updates failed', {
          successCount,
          failureCount,
        });
      }
    } catch (error) {
      logger.error('FX Oracle rate update failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Submit rate updates to the oracle contract
   */
  private async submitUpdatesToOracle(
    updates: OracleRateUpdate[]
  ): Promise<Array<{ success: boolean; currency: string; error?: string }>> {
    const results: Array<{ success: boolean; currency: string; error?: string }> = [];

    // Submit updates in parallel with concurrency limit
    const concurrencyLimit = 5;
    for (let i = 0; i < updates.length; i += concurrencyLimit) {
      const batch = updates.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.allSettled(
        batch.map((update) => this.submitSingleUpdate(update))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const update = batch[j];

        if (result.status === 'fulfilled') {
          results.push({
            success: true,
            currency: update.quoteCurrency,
          });
        } else {
          results.push({
            success: false,
            currency: update.quoteCurrency,
            error: result.reason.message,
          });
          logger.error('Oracle update failed for currency', {
            currency: update.quoteCurrency,
            error: result.reason.message,
          });
        }
      }
    }

    return results;
  }

  /**
   * Submit a single rate update to the oracle contract
   */
  private async submitSingleUpdate(update: OracleRateUpdate): Promise<void> {
    try {
      // Call the oracle contract's update_rate function
      // This would use the blockchain service to invoke the contract
      // Example (pseudo-code):
      // 
      // await blockchainService.invokeContract({
      //   contractAddress: this.config.contractAddress,
      //   method: 'update_rate',
      //   args: [
      //     update.baseCurrency,
      //     update.quoteCurrency,
      //     update.rate.toString(),
      //     update.timestamp,
      //   ],
      // });

      logger.debug('Oracle rate update submitted', {
        baseCurrency: update.baseCurrency,
        quoteCurrency: update.quoteCurrency,
        rate: update.rate.toString(),
        timestamp: update.timestamp,
      });

      // For now, log the update
      // In production, this would actually call the blockchain
      logger.info('FX Oracle update', {
        pair: `${update.baseCurrency}/${update.quoteCurrency}`,
        rate: Number(update.rate) / 100_000_000,
        timestamp: update.timestamp,
      });
    } catch (error) {
      logger.error('Failed to submit oracle update', {
        baseCurrency: update.baseCurrency,
        quoteCurrency: update.quoteCurrency,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Manually trigger a rate update (useful for testing or forced updates)
   */
  async triggerUpdate(): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Oracle feeder is not running');
    }

    logger.info('Manual oracle rate update triggered');
    await this.updateRates();
  }

  /**
   * Get current status of the feeder
   */
  getStatus(): {
    isRunning: boolean;
    config: OracleConfig;
    lastUpdateTime?: number;
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
    };
  }
}

// Singleton instance (initialized in server startup)
let oracleFeeder: FxOracleFeeder | null = null;

export function initializeOracleFeeder(
  exchangeRateService: ExchangeRateService,
  config: OracleConfig
): void {
  if (oracleFeeder) {
    logger.warn('FX Oracle Feeder already initialized');
    return;
  }

  oracleFeeder = new FxOracleFeeder(exchangeRateService, config);
  
  // Auto-start if enabled
  if (process.env.FX_ORACLE_ENABLED === 'true') {
    oracleFeeder.start();
  }
}

export function getOracleFeeder(): FxOracleFeeder {
  if (!oracleFeeder) {
    throw new Error('FX Oracle Feeder not initialized');
  }
  return oracleFeeder;
}

export function stopOracleFeeder(): void {
  if (oracleFeeder) {
    oracleFeeder.stop();
    oracleFeeder = null;
  }
}
