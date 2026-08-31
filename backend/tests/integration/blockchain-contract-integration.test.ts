/**
 * Backend-to-contract integration tests (Backlog #75).
 *
 * Exercises simulated Soroban contract invocations from BlockchainService
 * and covers RPC failure modes without requiring a live network.
 */

import {
  captures,
  mockRpc,
  resetSorobanMocks,
  scValKind,
  setSendError,
  setSimulationError,
} from './soroban-mock-harness';

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: jest.fn().mockImplementation(() => mockRpc),
      assembleTransaction: jest.fn((tx: unknown) => ({
        build: () => tx,
      })),
    },
  };
});

jest.mock('../../src/config/database', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'log-1' },
            error: null,
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    })),
  },
}));

jest.mock('../../src/config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/services/secret-provider', () => ({
  secretProvider: {
    getSecret: jest.fn(async (key: string) => process.env[key] ?? null),
  },
}));

jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(undefined),
    lPush: jest.fn().mockResolvedValue(1),
  }),
}));

import { Keypair } from '@stellar/stellar-sdk';
import {
  BLOCKCHAIN_INVOKE_METHODS,
  getSubscriptionBinding,
} from '../../src/blockchain/backend-contract-bindings';

const keypair = Keypair.random();

async function loadBlockchainService(options?: { secret?: string | null }) {
  jest.resetModules();
  if (options?.secret === null || options?.secret === '') {
    delete process.env.STELLAR_SECRET_KEY;
  } else {
    process.env.STELLAR_SECRET_KEY = options?.secret ?? keypair.secret();
  }
  return import('../../src/services/blockchain-service');
}

function withBlockchainEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }

  return fn().finally(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });
}

describe('BlockchainService contract integration (simulated)', () => {
  jest.setTimeout(15000);

  beforeEach(() => {
    resetSorobanMocks(keypair.publicKey());
    process.env.STELLAR_SECRET_KEY = keypair.secret();
  });

  describe('successful simulated invocations', () => {
    it('invokes create_subscription on subscription create', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          const { blockchainService } = await loadBlockchainService();
          const binding = getSubscriptionBinding('create');

          const result = await blockchainService.syncSubscription(
            'user-1',
            'sub-abc',
            'create',
            {
              name: 'Netflix',
              price: '15.99',
              billing_cycle: 'monthly',
              status: 'active',
            },
          );

          expect(result.success).toBe(true);
          expect(result.transactionHash).toBeDefined();
          expect(captures).toHaveLength(1);
          expect(captures[0].method).toBe(binding.method);
          expect(captures[0].method).toBe('create_subscription');
          expect(mockRpc.simulateTransaction).toHaveBeenCalled();
          expect(mockRpc.sendTransaction).toHaveBeenCalled();
        },
      );
    });

    it('invokes record_log for reminder events', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          const { blockchainService } = await loadBlockchainService();

          const result = await blockchainService.logReminderEvent(
            'user-1',
            {
              subscription: {
                id: 'sub-1',
                name: 'Spotify',
                price: 9.99,
                billing_cycle: 'monthly',
              },
              reminderType: 'renewal',
              renewalDate: '2026-07-01',
              daysBefore: 3,
            } as any,
            ['email'],
          );

          expect(result.success).toBe(true);
          expect(captures[0].method).toBe(BLOCKCHAIN_INVOKE_METHODS.logReminder);
          expect(captures[0].method).toBe('record_log');
        },
      );
    });

    it('invokes record_log for gift card attachment', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          const { blockchainService } = await loadBlockchainService();

          const result = await blockchainService.logGiftCardAttached(
            'user-1',
            'sub-1',
            'hash-abc',
            'amazon',
          );

          expect(result.success).toBe(true);
          expect(captures[0].method).toBe(BLOCKCHAIN_INVOKE_METHODS.giftCardAttached);
        },
      );
    });

    it('maps cancel and delete operations to cancel_subscription', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          const { blockchainService } = await loadBlockchainService();

          await blockchainService.syncSubscription('u', 'sub-1', 'cancel', {
            name: 'X',
            price: '1',
            billing_cycle: 'monthly',
            status: 'cancelled',
          });
          expect(captures[0].method).toBe('cancel_subscription');

          resetSorobanMocks(keypair.publicKey());
          await blockchainService.syncSubscription('u', 'sub-2', 'delete', {
            name: 'Y',
            price: '1',
            billing_cycle: 'monthly',
            status: 'deleted',
          });
          expect(captures[0].method).toBe('cancel_subscription');
        },
      );
    });

    it('encodes subscription args as ScVal strings (current encoder)', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          const { blockchainService } = await loadBlockchainService();

          await blockchainService.syncSubscription('u', 'sub-enc', 'create', {
            name: 'Test',
            price: '5',
            billing_cycle: 'monthly',
            status: 'active',
          });

          const { args } = captures[0];
          expect(args.length).toBeGreaterThan(0);
          for (const arg of args) {
            expect(['scvString', 'scvVec']).toContain(scValKind(arg));
          }
        },
      );
    });
  });

  describe('failure modes', () => {
    it('returns blockchain error when simulation fails', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          setSimulationError('InvalidAction: unknown function');

          const { blockchainService } = await loadBlockchainService();
          const result = await blockchainService.syncSubscription('u', 'sub-fail', 'create', {
            name: 'Fail',
            price: '1',
            billing_cycle: 'monthly',
            status: 'active',
          });

          expect(result.success).toBe(true);
          expect(result.error).toMatch(/Simulation failed|InvalidAction/);
          expect(mockRpc.simulateTransaction).toHaveBeenCalled();
        },
      );
    });

    it('returns blockchain error when sendTransaction fails', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          setSendError('tx_insufficient_fee');

          const { blockchainService } = await loadBlockchainService();
          const result = await blockchainService.syncSubscription('u', 'sub-send', 'create', {
            name: 'SendFail',
            price: '1',
            billing_cycle: 'monthly',
            status: 'active',
          });

          expect(result.success).toBe(true);
          expect(result.error).toMatch(/Send failed|tx_insufficient_fee/);
        },
      );
    });

    it('skips on-chain invoke when contract address is not configured', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: undefined,
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          const { blockchainService } = await loadBlockchainService();
          const result = await blockchainService.syncSubscription('u', 'sub-no-addr', 'create', {
            name: 'NoAddr',
            price: '1',
            billing_cycle: 'monthly',
            status: 'active',
          });

          expect(result.success).toBe(true);
          expect(result.transactionHash).toBeUndefined();
          expect(captures).toHaveLength(0);
        },
      );
    });

    it('blocks on-chain write when ENABLE_BLOCKCHAIN is false', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'false',
          NODE_ENV: 'test',
        },
        async () => {
          const { blockchainService } = await loadBlockchainService();
          const result = await blockchainService.syncSubscription('u', 'sub-disabled', 'create', {
            name: 'Disabled',
            price: '1',
            billing_cycle: 'monthly',
            status: 'active',
          });

          expect(result.success).toBe(true);
          expect(result.error).toMatch(/ENABLE_BLOCKCHAIN/);
          expect(captures).toHaveLength(0);
        },
      );
    });

    it('returns error when STELLAR_SECRET_KEY is missing', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          process.env.STELLAR_SECRET_KEY = '';
          const { blockchainService } = await loadBlockchainService({ secret: '' });
          const result = await blockchainService.syncSubscription('u', 'sub-no-key', 'create', {
            name: 'NoKey',
            price: '1',
            billing_cycle: 'monthly',
            status: 'active',
          });

          expect(result.success).toBe(true);
          expect(result.error).toMatch(/STELLAR_SECRET_KEY/);
        },
      );
    });

    it('retries on transient RPC errors before surfacing failure', async () => {
      await withBlockchainEnv(
        {
          SOROBAN_CONTRACT_ADDRESS: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          ENABLE_BLOCKCHAIN: 'true',
          NODE_ENV: 'test',
        },
        async () => {
          mockRpc.getAccount
            .mockRejectedValueOnce(new Error('ECONNRESET'))
            .mockRejectedValueOnce(new Error('ECONNRESET'))
            .mockResolvedValue({
              accountId: () => Keypair.random().publicKey(),
              sequenceNumber: () => '1',
              incrementSequenceNumber: jest.fn(),
            });

          const { blockchainService } = await loadBlockchainService();
          const result = await blockchainService.syncSubscription('u', 'sub-retry', 'create', {
            name: 'Retry',
            price: '1',
            billing_cycle: 'monthly',
            status: 'active',
          });

          expect(result.success).toBe(true);
          expect(result.transactionHash).toBeDefined();
          expect(mockRpc.getAccount.mock.calls.length).toBeGreaterThanOrEqual(3);
        },
      );
    });
  });
});
