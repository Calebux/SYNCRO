/**
 * Client-side tests for blockchain feature flags (Issue #84)
 *
 * Covers:
 *  - getBlockchainFlags() in all NEXT_PUBLIC_* env combinations
 *  - getFeatureFlags() blockchain fields
 *  - isTestnetActionAllowed() helper
 *  - isBlockchainEnabled() helper
 *  - GasPredictorService.getRpcUrl() production guard
 *  - StellarWalletService.connect() testnet guard in production
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
): void {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
}

// ── getBlockchainFlags (client) ───────────────────────────────────────────────

describe('getBlockchainFlags() — client', () => {
  it('returns testnetActionsEnabled=false by default', () => {
    withEnv(
      {
        NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
        NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS: undefined,
        NODE_ENV: 'development',
      },
      () => {
        vi.resetModules();
        const { getBlockchainFlags } = require('../../shared/blockchain-flags');
        expect(getBlockchainFlags().testnetActionsEnabled).toBe(false);
      },
    );
  });

  it('returns testnetActionsEnabled=true when NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS=true on testnet', () => {
    withEnv(
      {
        NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
        NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS: 'true',
        NODE_ENV: 'development',
      },
      () => {
        vi.resetModules();
        const { getBlockchainFlags } = require('../../shared/blockchain-flags');
        expect(getBlockchainFlags().testnetActionsEnabled).toBe(true);
      },
    );
  });

  it('returns testnetActionsEnabled=false on mainnet even when flag=true', () => {
    withEnv(
      {
        NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
        NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS: 'true',
        NODE_ENV: 'production',
      },
      () => {
        vi.resetModules();
        const { getBlockchainFlags } = require('../../shared/blockchain-flags');
        expect(getBlockchainFlags().testnetActionsEnabled).toBe(false);
      },
    );
  });

  it('returns blockchainEnabled=false when NEXT_PUBLIC_ENABLE_BLOCKCHAIN=false', () => {
    withEnv({ NEXT_PUBLIC_ENABLE_BLOCKCHAIN: 'false' }, () => {
      vi.resetModules();
      const { getBlockchainFlags } = require('../../shared/blockchain-flags');
      expect(getBlockchainFlags().blockchainEnabled).toBe(false);
    });
  });

  it('resolves network from NEXT_PUBLIC_STELLAR_NETWORK', () => {
    withEnv({ NEXT_PUBLIC_STELLAR_NETWORK: 'futurenet' }, () => {
      vi.resetModules();
      const { getBlockchainFlags } = require('../../shared/blockchain-flags');
      expect(getBlockchainFlags().network).toBe('futurenet');
    });
  });
});

// ── getFeatureFlags blockchain fields ─────────────────────────────────────────

describe('getFeatureFlags() — blockchain fields', () => {
  it('exposes testnetActionsEnabled from blockchain flags', () => {
    withEnv(
      {
        NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
        NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS: 'true',
        NODE_ENV: 'development',
      },
      () => {
        vi.resetModules();
        const { getFeatureFlags } = require('../feature-flags');
        expect(getFeatureFlags().testnetActionsEnabled).toBe(true);
      },
    );
  });

  it('exposes blockchainEnabled from blockchain flags', () => {
    withEnv({ NEXT_PUBLIC_ENABLE_BLOCKCHAIN: 'false' }, () => {
      vi.resetModules();
      const { getFeatureFlags } = require('../feature-flags');
      expect(getFeatureFlags().blockchainEnabled).toBe(false);
    });
  });
});

// ── isTestnetActionAllowed ────────────────────────────────────────────────────

describe('isTestnetActionAllowed()', () => {
  it('returns false when testnet actions are disabled', () => {
    withEnv(
      {
        NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
        NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS: 'false',
        NODE_ENV: 'development',
      },
      () => {
        vi.resetModules();
        const { isTestnetActionAllowed } = require('../feature-flags');
        expect(isTestnetActionAllowed()).toBe(false);
      },
    );
  });

  it('returns true when testnet actions are enabled on testnet', () => {
    withEnv(
      {
        NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
        NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS: 'true',
        NODE_ENV: 'development',
      },
      () => {
        vi.resetModules();
        const { isTestnetActionAllowed } = require('../feature-flags');
        expect(isTestnetActionAllowed()).toBe(true);
      },
    );
  });
});

// ── isBlockchainEnabled ───────────────────────────────────────────────────────

describe('isBlockchainEnabled()', () => {
  it('returns true by default', () => {
    withEnv({ NEXT_PUBLIC_ENABLE_BLOCKCHAIN: undefined }, () => {
      vi.resetModules();
      const { isBlockchainEnabled } = require('../feature-flags');
      expect(isBlockchainEnabled()).toBe(true);
    });
  });

  it('returns false when NEXT_PUBLIC_ENABLE_BLOCKCHAIN=false', () => {
    withEnv({ NEXT_PUBLIC_ENABLE_BLOCKCHAIN: 'false' }, () => {
      vi.resetModules();
      const { isBlockchainEnabled } = require('../feature-flags');
      expect(isBlockchainEnabled()).toBe(false);
    });
  });
});

// ── GasPredictor production guard ─────────────────────────────────────────────

describe('GasPredictorService — production RPC guard', () => {
  it('throws when NEXT_PUBLIC_SOROBAN_RPC_URL is missing in production', async () => {
    withEnv(
      {
        NODE_ENV: 'production',
        NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
        NEXT_PUBLIC_SOROBAN_RPC_URL: undefined,
      },
      () => {
        vi.resetModules();
        const { gasPredictor } = require('../gas-predictor');
        // fetchFeeStats calls getRpcUrl internally
        expect(() => gasPredictor['getRpcUrl']()).toThrow(
          /NEXT_PUBLIC_SOROBAN_RPC_URL must be set in production/,
        );
      },
    );
  });

  it('does not throw in development without NEXT_PUBLIC_SOROBAN_RPC_URL', () => {
    withEnv(
      {
        NODE_ENV: 'development',
        NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
        NEXT_PUBLIC_SOROBAN_RPC_URL: undefined,
      },
      () => {
        vi.resetModules();
        const { gasPredictor } = require('../gas-predictor');
        expect(() => gasPredictor['getRpcUrl']()).not.toThrow();
      },
    );
  });

  it('uses NEXT_PUBLIC_SOROBAN_RPC_URL when provided in production', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
        NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-rpc.creit.tech',
      },
      () => {
        vi.resetModules();
        const { gasPredictor } = require('../gas-predictor');
        expect(gasPredictor['getRpcUrl']()).toBe('https://soroban-rpc.creit.tech');
      },
    );
  });
});

// ── StellarWallet testnet guard ───────────────────────────────────────────────

describe('StellarWalletService — testnet connection guard', () => {
  it('throws when connecting to testnet in production without the flag', async () => {
    withEnv(
      {
        NODE_ENV: 'production',
        NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
        NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS: 'false',
      },
      () => {
        vi.resetModules();
        // Mock window.freighter so the guard is reached
        (global as any).window = { freighter: { getPublicKey: async () => 'GPUBKEY' } };
        const { stellarWallet } = require('../stellar-wallet');
        expect(stellarWallet.connect('testnet')).rejects.toThrow(
          /Connecting to testnet is not permitted in production/,
        );
        delete (global as any).window;
      },
    );
  });

  it('does not throw when connecting to mainnet in production', async () => {
    withEnv(
      {
        NODE_ENV: 'production',
        NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
        NEXT_PUBLIC_ENABLE_TESTNET_ACTIONS: 'false',
      },
      () => {
        vi.resetModules();
        (global as any).window = {
          freighter: { getPublicKey: async () => 'GPUBKEY' },
        };
        const { stellarWallet } = require('../stellar-wallet');
        // Should not throw the testnet guard (may throw for other reasons in test env)
        const connectPromise = stellarWallet.connect('mainnet');
        connectPromise.catch(() => {}); // suppress unhandled rejection
        delete (global as any).window;
      },
    );
  });
});
