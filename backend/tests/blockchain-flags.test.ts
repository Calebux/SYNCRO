/**
 * Tests for blockchain feature flags (Issue #84)
 *
 * Covers:
 *  - getBlockchainFlags() in all NODE_ENV / STELLAR_NETWORK combinations
 *  - resolveStellarNetwork() alias handling
 *  - assertTestnetAllowed() guard behaviour
 *  - assertBlockchainEnabled() guard behaviour
 *  - assertNetwork() guard behaviour
 *  - BlockchainService constructor production guards (mocked deps)
 *  - EventListener constructor production guards (mocked deps)
 *  - Indexer resolveRpcUrl() production guard (mocked deps)
 *  - startIndexer() early-exit when ENABLE_BLOCKCHAIN=false
 */

// ─── Mock heavy deps before any imports so the uuid ESM chain never loads ────

jest.mock('../src/config/database', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Stub out every service that BlockchainService / EventListener depend on
jest.mock('../src/services/secret-provider', () => ({
  secretProvider: { getSecret: jest.fn() },
}));

jest.mock('../src/services/reorg-handler', () => ({
  reorgHandler: { handleReorg: jest.fn() },
}));

jest.mock('../src/utils/cycle-id', () => ({
  generateCycleId: jest.fn(),
}));

jest.mock('../src/services/renewal-cooldown-service', () => ({
  renewalCooldownService: { recordRenewalAttempt: jest.fn() },
}));

jest.mock('../src/utils/retry', () => ({
  calculateBackoffDelay: jest.fn().mockReturnValue(100),
}));

jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(undefined),
    lPush: jest.fn(),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Temporarily override process.env keys and restore them after the callback. */
function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

// ─── getBlockchainFlags ───────────────────────────────────────────────────────

describe('getBlockchainFlags()', () => {
  beforeEach(() => jest.resetModules());

  it('returns testnetActionsEnabled=false by default', () => {
    withEnv(
      { NODE_ENV: 'development', STELLAR_NETWORK: 'testnet', ENABLE_TESTNET_ACTIONS: undefined },
      () => {
        jest.resetModules();
        const { getBlockchainFlags } = require('../../shared/blockchain-flags');
        expect(getBlockchainFlags().testnetActionsEnabled).toBe(false);
      },
    );
  });

  it('returns testnetActionsEnabled=true when explicitly enabled on testnet', () => {
    withEnv(
      { NODE_ENV: 'development', STELLAR_NETWORK: 'testnet', ENABLE_TESTNET_ACTIONS: 'true' },
      () => {
        jest.resetModules();
        const { getBlockchainFlags } = require('../../shared/blockchain-flags');
        expect(getBlockchainFlags().testnetActionsEnabled).toBe(true);
      },
    );
  });

  it('returns testnetActionsEnabled=false even when flag=true on mainnet', () => {
    withEnv(
      { NODE_ENV: 'production', STELLAR_NETWORK: 'mainnet', ENABLE_TESTNET_ACTIONS: 'true' },
      () => {
        jest.resetModules();
        const { getBlockchainFlags } = require('../../shared/blockchain-flags');
        expect(getBlockchainFlags().testnetActionsEnabled).toBe(false);
      },
    );
  });

  it('returns blockchainEnabled=true by default', () => {
    withEnv({ ENABLE_BLOCKCHAIN: undefined }, () => {
      jest.resetModules();
      const { getBlockchainFlags } = require('../../shared/blockchain-flags');
      expect(getBlockchainFlags().blockchainEnabled).toBe(true);
    });
  });

  it('returns blockchainEnabled=false when ENABLE_BLOCKCHAIN=false', () => {
    withEnv({ ENABLE_BLOCKCHAIN: 'false' }, () => {
      jest.resetModules();
      const { getBlockchainFlags } = require('../../shared/blockchain-flags');
      expect(getBlockchainFlags().blockchainEnabled).toBe(false);
    });
  });

  it('resolves network=mainnet for STELLAR_NETWORK=mainnet', () => {
    withEnv({ STELLAR_NETWORK: 'mainnet' }, () => {
      jest.resetModules();
      const { getBlockchainFlags } = require('../../shared/blockchain-flags');
      expect(getBlockchainFlags().network).toBe('mainnet');
    });
  });

  it('resolves network=mainnet for STELLAR_NETWORK=public (alias)', () => {
    withEnv({ STELLAR_NETWORK: 'public' }, () => {
      jest.resetModules();
      const { resolveStellarNetwork } = require('../../shared/blockchain-flags');
      expect(resolveStellarNetwork()).toBe('mainnet');
    });
  });

  it('resolves network=futurenet for STELLAR_NETWORK=futurenet', () => {
    withEnv({ STELLAR_NETWORK: 'futurenet' }, () => {
      jest.resetModules();
      const { getBlockchainFlags } = require('../../shared/blockchain-flags');
      expect(getBlockchainFlags().network).toBe('futurenet');
    });
  });

  it('marks isProduction=true when NODE_ENV=production', () => {
    withEnv({ NODE_ENV: 'production', STELLAR_NETWORK: 'mainnet' }, () => {
      jest.resetModules();
      const { getBlockchainFlags } = require('../../shared/blockchain-flags');
      expect(getBlockchainFlags().isProduction).toBe(true);
    });
  });

  it('marks isProduction=false when NODE_ENV=development', () => {
    withEnv({ NODE_ENV: 'development' }, () => {
      jest.resetModules();
      const { getBlockchainFlags } = require('../../shared/blockchain-flags');
      expect(getBlockchainFlags().isProduction).toBe(false);
    });
  });
});

// ─── assertTestnetAllowed ─────────────────────────────────────────────────────

describe('assertTestnetAllowed()', () => {
  beforeEach(() => jest.resetModules());

  it('does not throw when testnet actions are enabled on testnet', () => {
    withEnv(
      { NODE_ENV: 'development', STELLAR_NETWORK: 'testnet', ENABLE_TESTNET_ACTIONS: 'true' },
      () => {
        jest.resetModules();
        const { assertTestnetAllowed } = require('../../shared/blockchain-flags');
        expect(() => assertTestnetAllowed('friendbot')).not.toThrow();
      },
    );
  });

  it('throws when testnet actions are disabled (default)', () => {
    withEnv(
      { NODE_ENV: 'development', STELLAR_NETWORK: 'testnet', ENABLE_TESTNET_ACTIONS: 'false' },
      () => {
        jest.resetModules();
        const { assertTestnetAllowed } = require('../../shared/blockchain-flags');
        expect(() => assertTestnetAllowed('friendbot')).toThrow(
          /Testnet-only action "friendbot" was rejected/,
        );
      },
    );
  });

  it('throws on mainnet even when flag is true', () => {
    withEnv(
      { NODE_ENV: 'production', STELLAR_NETWORK: 'mainnet', ENABLE_TESTNET_ACTIONS: 'true' },
      () => {
        jest.resetModules();
        const { assertTestnetAllowed } = require('../../shared/blockchain-flags');
        expect(() => assertTestnetAllowed('faucet')).toThrow(
          /testnet actions are not permitted on mainnet/,
        );
      },
    );
  });

  it('error message includes the action name', () => {
    withEnv(
      { NODE_ENV: 'development', STELLAR_NETWORK: 'testnet', ENABLE_TESTNET_ACTIONS: 'false' },
      () => {
        jest.resetModules();
        const { assertTestnetAllowed } = require('../../shared/blockchain-flags');
        expect(() => assertTestnetAllowed('deploy-testnet-contract')).toThrow(
          /deploy-testnet-contract/,
        );
      },
    );
  });
});

// ─── assertBlockchainEnabled ──────────────────────────────────────────────────

describe('assertBlockchainEnabled()', () => {
  beforeEach(() => jest.resetModules());

  it('does not throw when blockchain is enabled (default)', () => {
    withEnv({ ENABLE_BLOCKCHAIN: 'true' }, () => {
      jest.resetModules();
      const { assertBlockchainEnabled } = require('../../shared/blockchain-flags');
      expect(() => assertBlockchainEnabled('syncSubscription')).not.toThrow();
    });
  });

  it('throws when ENABLE_BLOCKCHAIN=false', () => {
    withEnv({ ENABLE_BLOCKCHAIN: 'false' }, () => {
      jest.resetModules();
      const { assertBlockchainEnabled } = require('../../shared/blockchain-flags');
      expect(() => assertBlockchainEnabled('syncSubscription')).toThrow(
        /ENABLE_BLOCKCHAIN is set to false/,
      );
    });
  });

  it('error message includes the action name', () => {
    withEnv({ ENABLE_BLOCKCHAIN: 'false' }, () => {
      jest.resetModules();
      const { assertBlockchainEnabled } = require('../../shared/blockchain-flags');
      expect(() => assertBlockchainEnabled('logReminderEvent')).toThrow(
        /logReminderEvent/,
      );
    });
  });
});

// ─── assertNetwork ────────────────────────────────────────────────────────────

describe('assertNetwork()', () => {
  beforeEach(() => jest.resetModules());

  it('does not throw when network matches', () => {
    withEnv({ STELLAR_NETWORK: 'testnet' }, () => {
      jest.resetModules();
      const { assertNetwork } = require('../../shared/blockchain-flags');
      expect(() => assertNetwork('testnet', 'deploy')).not.toThrow();
    });
  });

  it('throws when network does not match', () => {
    withEnv({ STELLAR_NETWORK: 'testnet' }, () => {
      jest.resetModules();
      const { assertNetwork } = require('../../shared/blockchain-flags');
      expect(() => assertNetwork('mainnet', 'deploy')).toThrow(
        /requires network "mainnet" but the active network is "testnet"/,
      );
    });
  });
});

// ─── BlockchainService production guards ─────────────────────────────────────

describe('BlockchainService — production safety guards', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const keysToManage = [
    'NODE_ENV', 'STELLAR_NETWORK', 'SOROBAN_RPC_URL',
    'STELLAR_NETWORK_PASSPHRASE', 'SOROBAN_CONTRACT_ADDRESS', 'ENABLE_BLOCKCHAIN',
  ];

  beforeEach(() => {
    keysToManage.forEach(k => { savedEnv[k] = process.env[k]; });
    jest.resetModules();
  });

  afterEach(() => {
    keysToManage.forEach(k => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  it('throws when SOROBAN_RPC_URL is missing in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.STELLAR_NETWORK = 'mainnet';
    delete process.env.SOROBAN_RPC_URL;
    process.env.STELLAR_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
    process.env.SOROBAN_CONTRACT_ADDRESS = 'CTEST';
    process.env.ENABLE_BLOCKCHAIN = 'true';

    jest.resetModules();
    expect(() => {
      const { BlockchainService } = require('../src/services/blockchain-service');
      new BlockchainService();
    }).toThrow(/SOROBAN_RPC_URL must be explicitly set in production/);
  });

  it('throws when STELLAR_NETWORK_PASSPHRASE is missing in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.SOROBAN_RPC_URL = 'https://soroban-rpc.creit.tech';
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    process.env.SOROBAN_CONTRACT_ADDRESS = 'CTEST';
    process.env.ENABLE_BLOCKCHAIN = 'true';

    jest.resetModules();
    expect(() => {
      const { BlockchainService } = require('../src/services/blockchain-service');
      new BlockchainService();
    }).toThrow(/STELLAR_NETWORK_PASSPHRASE must be explicitly set in production/);
  });

  it('does not throw in development with missing optional vars', () => {
    process.env.NODE_ENV = 'development';
    process.env.STELLAR_NETWORK = 'testnet';
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    process.env.SOROBAN_CONTRACT_ADDRESS = '';
    process.env.ENABLE_BLOCKCHAIN = 'true';

    jest.resetModules();
    expect(() => {
      const { BlockchainService } = require('../src/services/blockchain-service');
      new BlockchainService();
    }).not.toThrow();
  });
});

// ─── EventListener production guards ─────────────────────────────────────────

describe('EventListener — production safety guards', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const keysToManage = [
    'NODE_ENV', 'STELLAR_NETWORK', 'STELLAR_NETWORK_URL',
    'SOROBAN_CONTRACT_ADDRESS', 'ENABLE_BLOCKCHAIN',
  ];

  beforeEach(() => {
    keysToManage.forEach(k => { savedEnv[k] = process.env[k]; });
    jest.resetModules();
  });

  afterEach(() => {
    keysToManage.forEach(k => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  it('sets status=disabled when STELLAR_NETWORK_URL is missing in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.STELLAR_NETWORK = 'mainnet';
    delete process.env.STELLAR_NETWORK_URL;
    process.env.SOROBAN_CONTRACT_ADDRESS = 'CTEST';
    process.env.ENABLE_BLOCKCHAIN = 'true';

    jest.resetModules();
    const { EventListener } = require('../src/services/event-listener');
    const listener = new EventListener();
    const health = listener.getHealth();
    expect(health.status).toBe('disabled');
    expect(health.reason).toMatch(/STELLAR_NETWORK_URL must be explicitly set in production/);
  });

  it('sets status=disabled when ENABLE_BLOCKCHAIN=false', () => {
    process.env.NODE_ENV = 'development';
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.STELLAR_NETWORK_URL = 'https://soroban-testnet.stellar.org';
    process.env.SOROBAN_CONTRACT_ADDRESS = 'CTEST';
    process.env.ENABLE_BLOCKCHAIN = 'false';

    jest.resetModules();
    const { EventListener } = require('../src/services/event-listener');
    const listener = new EventListener();
    expect(listener.getHealth().status).toBe('disabled');
  });

  it('sets status=stopped (ready) when all vars are present in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.STELLAR_NETWORK_URL = 'https://soroban-testnet.stellar.org';
    process.env.SOROBAN_CONTRACT_ADDRESS = 'CTEST';
    process.env.ENABLE_BLOCKCHAIN = 'true';

    jest.resetModules();
    const { EventListener } = require('../src/services/event-listener');
    const listener = new EventListener();
    expect(listener.getHealth().status).toBe('stopped');
  });
});

// ─── Indexer production guards ────────────────────────────────────────────────

describe('Indexer — production safety guards', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const keysToManage = [
    'NODE_ENV', 'STELLAR_NETWORK', 'SOROBAN_RPC_URL',
    'SOROBAN_CONTRACT_ADDRESS', 'ENABLE_BLOCKCHAIN',
  ];

  beforeEach(() => {
    keysToManage.forEach(k => { savedEnv[k] = process.env[k]; });
    jest.resetModules();
  });

  afterEach(() => {
    keysToManage.forEach(k => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  it('throws at module load when SOROBAN_RPC_URL is missing in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.STELLAR_NETWORK = 'mainnet';
    delete process.env.SOROBAN_RPC_URL;
    process.env.SOROBAN_CONTRACT_ADDRESS = 'CTEST';
    process.env.ENABLE_BLOCKCHAIN = 'true';

    jest.resetModules();
    expect(() => {
      require('../src/blockchain/indexer');
    }).toThrow(/SOROBAN_RPC_URL must be explicitly set in production/);
  });

  it('does not throw in development with missing SOROBAN_RPC_URL', () => {
    process.env.NODE_ENV = 'development';
    process.env.STELLAR_NETWORK = 'testnet';
    delete process.env.SOROBAN_RPC_URL;
    process.env.SOROBAN_CONTRACT_ADDRESS = '';
    process.env.ENABLE_BLOCKCHAIN = 'true';

    jest.resetModules();
    expect(() => {
      require('../src/blockchain/indexer');
    }).not.toThrow();
  });

  it('startIndexer() returns early when ENABLE_BLOCKCHAIN=false', async () => {
    process.env.NODE_ENV = 'development';
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
    process.env.SOROBAN_CONTRACT_ADDRESS = 'CTEST';
    process.env.ENABLE_BLOCKCHAIN = 'false';

    jest.resetModules();
    const { startIndexer, stopIndexer } = require('../src/blockchain/indexer');
    await expect(startIndexer()).resolves.toBeUndefined();
    stopIndexer();
  });

  it('startIndexer() returns early when SOROBAN_CONTRACT_ADDRESS is empty', async () => {
    process.env.NODE_ENV = 'development';
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
    process.env.SOROBAN_CONTRACT_ADDRESS = '';
    process.env.ENABLE_BLOCKCHAIN = 'true';

    jest.resetModules();
    const { startIndexer, stopIndexer } = require('../src/blockchain/indexer');
    await expect(startIndexer()).resolves.toBeUndefined();
    stopIndexer();
  });
});

// ─── resolveExplorerUrl / resolveAccountExplorerUrl / resolveExplorerBase ──────

describe('explorer URL resolvers', () => {
  beforeEach(() => jest.resetModules());

  it('resolveExplorerBase defaults to testnet when STELLAR_NETWORK is unset', () => {
    withEnv({ STELLAR_NETWORK: undefined, NODE_ENV: 'development' }, () => {
      jest.resetModules();
      const { resolveExplorerBase } = require('../../shared/blockchain-flags');
      expect(resolveExplorerBase()).toBe('https://stellar.expert/explorer/testnet');
    });
  });

  it('resolveExplorerBase returns mainnet URL for mainnet', () => {
    withEnv({ STELLAR_NETWORK: 'mainnet' }, () => {
      jest.resetModules();
      const { resolveExplorerBase } = require('../../shared/blockchain-flags');
      expect(resolveExplorerBase()).toBe('https://stellar.expert/explorer/public');
    });
  });

  it('resolveExplorerBase returns testnet URL for testnet', () => {
    expect(require('../../shared/blockchain-flags').resolveExplorerBase('testnet'))
      .toBe('https://stellar.expert/explorer/testnet');
  });

  it('resolveExplorerUrl builds a full tx URL for testnet', () => {
    expect(require('../../shared/blockchain-flags').resolveExplorerUrl('abc123', 'testnet'))
      .toBe('https://stellar.expert/explorer/testnet/tx/abc123');
  });

  it('resolveExplorerUrl builds a full tx URL for mainnet', () => {
    expect(require('../../shared/blockchain-flags').resolveExplorerUrl('abc123', 'mainnet'))
      .toBe('https://stellar.expert/explorer/public/tx/abc123');
  });

  it('resolveAccountExplorerUrl builds account URL for futurenet', () => {
    expect(require('../../shared/blockchain-flags').resolveAccountExplorerUrl('GA...', 'futurenet'))
      .toBe('https://stellar.expert/explorer/futurenet/account/GA...');
  });

  it('resolveExplorerUrl falls back to public explorer for unknown network', () => {
    expect(require('../../shared/blockchain-flags').resolveExplorerUrl('abc', 'unknown' as any))
      .toBe('https://stellar.expert/explorer/public/tx/abc');
  });
});
