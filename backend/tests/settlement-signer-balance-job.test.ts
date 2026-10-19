/**
 * settlement-signer-balance-job.test.ts
 *
 * Tests for the settlement signer balance monitoring job.
 * Covers:
 *  - Job starts and stops correctly
 *  - Warning alert fires when balance is below the warning threshold
 *  - Critical alert fires when balance is below the critical threshold
 *  - No alert fires when balance is above both thresholds
 *  - Job is disabled when SETTLEMENT_SIGNER_SECRET_KEY is not set
 *  - Metric settlement_signer_balance is exported correctly
 */

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  metrics: { gauge: jest.fn() },
}));

jest.mock('../src/services/settlement-signer-balance-service', () => ({
  settlementSignerBalanceService: {
    getSignerBalance: jest.fn(),
  },
}));

import { settlementSignerBalanceService } from '../src/services/settlement-signer-balance-service';
import { startSettlementSignerBalanceJob, stopSettlementSignerBalanceJob } from '../src/jobs/settlement-signer-balance-job';
import * as Sentry from '@sentry/node';
import { env } from '../src/config/env';

const mockGetSignerBalance = settlementSignerBalanceService.getSignerBalance as jest.Mock;
const mockCaptureMessage = Sentry.captureMessage as jest.Mock;
const mockGauge = (Sentry.metrics as any).gauge as jest.Mock;

describe('SettlementSignerBalanceJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: signer is configured
    process.env.SETTLEMENT_SIGNER_SECRET_KEY = 'SBCGDGAYHDW7MEXFL7HFL73HFL73HFL73HFL73HFL73HFL73HFL73HFL';
    process.env.SETTLEMENT_SIGNER_BALANCE_WARNING_THRESHOLD = '100';
    process.env.SETTLEMENT_SIGNER_BALANCE_CRITICAL_THRESHOLD = '20';
    process.env.SETTLEMENT_SIGNER_BALANCE_CHECK_CRON = '*/15 * * * *';
  });

  afterEach(() => {
    stopSettlementSignerBalanceJob();
  });

  describe('startSettlementSignerBalanceJob', () => {
    it('starts the scheduled job when SETTLEMENT_SIGNER_SECRET_KEY is set', () => {
      mockGetSignerBalance.mockResolvedValue({ balance: 500, accountId: 'GABC', fetchedAt: new Date().toISOString() });

      startSettlementSignerBalanceJob();
      // Job should be running — no error thrown
      expect(mockGetSignerBalance).toHaveBeenCalled();
    });

    it('does not start the job when SETTLEMENT_SIGNER_SECRET_KEY is not set', () => {
      delete process.env.SETTLEMENT_SIGNER_SECRET_KEY;
      const consoleSpy = jest.spyOn(console, 'info').mockImplementation();

      startSettlementSignerBalanceJob();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SettlementSignerBalance] Job disabled'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('alert thresholds', () => {
    it('fires a critical alert when balance is at or below the critical threshold', async () => {
      mockGetSignerBalance.mockResolvedValue({ balance: 15, accountId: 'GABC', fetchedAt: new Date().toISOString() });

      startSettlementSignerBalanceJob();
      // Wait for the cron to fire (it runs immediately in test mode via node-cron)
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
        expect.objectContaining({ level: 'critical' }),
      );
    });

    it('fires a warning alert when balance is at or below the warning threshold but above critical', async () => {
      mockGetSignerBalance.mockResolvedValue({ balance: 50, accountId: 'GABC', fetchedAt: new Date().toISOString() });

      startSettlementSignerBalanceJob();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        expect.stringContaining('WARNING'),
        expect.objectContaining({ level: 'warning' }),
      );
    });

    it('does not fire an alert when balance is above both thresholds', async () => {
      mockGetSignerBalance.mockResolvedValue({ balance: 500, accountId: 'GABC', fetchedAt: new Date().toISOString() });

      startSettlementSignerBalanceJob();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });
  });

  describe('metric export', () => {
    it('exports settlement_signer_balance as a Sentry gauge metric', async () => {
      mockGetSignerBalance.mockResolvedValue({ balance: 75, accountId: 'GABC', fetchedAt: new Date().toISOString() });

      startSettlementSignerBalanceJob();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockGauge).toHaveBeenCalledWith(
        'settlement_signer_balance',
        75,
        expect.objectContaining({ accountId: 'GABC' }),
      );
    });
  });
});
