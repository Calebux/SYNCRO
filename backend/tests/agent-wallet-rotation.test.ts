/**
 * Tests for AgentWalletRotationService.
 * Issue #862 — Privacy: Implement address rotation for agent wallets.
 */

import { AgentWalletRotationService, RotationSchedule } from '../src/services/agent-wallet-rotation';
import { AgentHDWallet, AgentName } from '../src/services/agent-hd-wallet';
import { supabase } from '../src/config/database';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/config/database', () => ({
  supabase: {
    from: jest.fn(),
    rpc:  jest.fn(),
  },
}));

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/services/agent-hd-wallet', () => {
  const actual = jest.requireActual('../src/services/agent-hd-wallet');
  return {
    ...actual,
    AgentHDWallet: {
      deriveKeypair: jest.fn(),
      deriveCurrentKeypair: jest.fn(),
      flushCache: jest.fn(),
    },
  };
});

// Mock blockchain flags so drain skips network calls
jest.mock('../../shared/blockchain-flags', () => ({
  getBlockchainFlags: jest.fn().mockReturnValue({ blockchainEnabled: false }),
  resolveStellarNetwork: jest.fn().mockReturnValue('testnet'),
}), { virtual: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

const { Keypair } = jest.requireActual('@stellar/stellar-sdk');

function makeMockDerived(agentName: AgentName, index: number) {
  const kp = Keypair.random();
  return {
    agentName,
    derivationPath: `m/0'/${index}'`,
    addressIndex: index,
    keypair: kp,
    publicKey: kp.publicKey(),
  };
}

function buildSupabaseChain(overrides: Record<string, any> = {}) {
  const chain: Record<string, jest.Mock> = {
    select:  jest.fn().mockReturnThis(),
    insert:  jest.fn().mockResolvedValue({ error: null }),
    update:  jest.fn().mockReturnThis(),
    upsert:  jest.fn().mockResolvedValue({ error: null }),
    eq:      jest.fn().mockReturnThis(),
    in:      jest.fn().mockReturnThis(),
    single:  jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    order:   jest.fn().mockReturnThis(),
    limit:   jest.fn().mockResolvedValue({ data: [], error: null }),
    is:      jest.fn().mockReturnThis(),
    ...overrides,
  };
  // Make each chainable method return the chain
  Object.keys(chain).forEach((key) => {
    if (key !== 'insert' && key !== 'upsert' && key !== 'single' && key !== 'limit') {
      (chain[key] as jest.Mock).mockReturnThis();
    }
  });
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentWalletRotationService', () => {
  let service: AgentWalletRotationService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default schedule
    process.env.AGENT_ROTATION_SCHEDULE = 'daily';
    service = new AgentWalletRotationService();
  });

  afterEach(() => {
    delete process.env.AGENT_ROTATION_SCHEDULE;
  });

  // ── Schedule resolution ──────────────────────────────────────────────────

  describe('schedule resolution', () => {
    it.each<[RotationSchedule]>([
      ['per-task'],
      ['daily'],
      ['weekly'],
      ['manual'],
    ])('accepts valid schedule "%s"', (schedule) => {
      process.env.AGENT_ROTATION_SCHEDULE = schedule;
      expect(() => new AgentWalletRotationService()).not.toThrow();
    });

    it('defaults to "daily" for unknown schedule value', () => {
      process.env.AGENT_ROTATION_SCHEDULE = 'unknown-value';
      // Should not throw; logged warning instead
      expect(() => new AgentWalletRotationService()).not.toThrow();
    });
  });

  // ── triggerRotation ──────────────────────────────────────────────────────

  describe('triggerRotation', () => {
    it('returns null when rotation is not due (manual schedule)', async () => {
      process.env.AGENT_ROTATION_SCHEDULE = 'manual';
      service = new AgentWalletRotationService();

      const chain = buildSupabaseChain();
      // loadState returns a state with lastRotatedAt = today
      chain.single = jest.fn().mockResolvedValue({
        data: {
          agent_name:      'scout',
          current_index:   0,
          public_key:      'GTEST',
          last_rotated_at: new Date().toISOString(),
          rotation_count:  1,
        },
        error: null,
      });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await service.triggerRotation('scout', false);
      expect(result).toBeNull();
    });

    it('rotates when force=true regardless of schedule', async () => {
      process.env.AGENT_ROTATION_SCHEDULE = 'manual';
      service = new AgentWalletRotationService();

      const oldDerived = makeMockDerived('scout', 2);
      const newDerived = makeMockDerived('scout', 3);

      (AgentHDWallet.deriveKeypair as jest.Mock)
        .mockResolvedValueOnce(oldDerived)  // previous
        .mockResolvedValueOnce(newDerived); // next

      const chain = buildSupabaseChain();
      chain.single = jest.fn().mockResolvedValue({
        data: {
          agent_name:      'scout',
          current_index:   2,
          public_key:      oldDerived.publicKey,
          last_rotated_at: new Date().toISOString(),
          rotation_count:  2,
        },
        error: null,
      });
      chain.update = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      chain.insert = jest.fn().mockResolvedValue({ error: null });

      (supabase.from as jest.Mock).mockReturnValue(chain);
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      const result = await service.triggerRotation('scout', true);

      expect(result).not.toBeNull();
      expect(result!.previousIndex).toBe(2);
      expect(result!.newIndex).toBe(3);
      expect(result!.agentName).toBe('scout');
      expect(result!.previousPublicKey).toBe(oldDerived.publicKey);
      expect(result!.newPublicKey).toBe(newDerived.publicKey);
    });

    it('rotates when lastRotatedAt is null (genesis)', async () => {
      process.env.AGENT_ROTATION_SCHEDULE = 'daily';
      service = new AgentWalletRotationService();

      const oldDerived = makeMockDerived('ledger', 0);
      const newDerived = makeMockDerived('ledger', 1);

      (AgentHDWallet.deriveKeypair as jest.Mock)
        .mockResolvedValueOnce(oldDerived)
        .mockResolvedValueOnce(newDerived);

      const chain = buildSupabaseChain();
      chain.single = jest.fn().mockResolvedValue({
        data: {
          agent_name:      'ledger',
          current_index:   0,
          public_key:      oldDerived.publicKey,
          last_rotated_at: null, // never rotated
          rotation_count:  0,
        },
        error: null,
      });
      chain.update = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      chain.insert = jest.fn().mockResolvedValue({ error: null });

      (supabase.from as jest.Mock).mockReturnValue(chain);
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      const result = await service.triggerRotation('ledger', false);

      expect(result).not.toBeNull();
      expect(result!.newIndex).toBe(1);
    });

    it('skips rotation when lastRotatedAt is today (daily schedule)', async () => {
      process.env.AGENT_ROTATION_SCHEDULE = 'daily';
      service = new AgentWalletRotationService();

      const chain = buildSupabaseChain();
      chain.single = jest.fn().mockResolvedValue({
        data: {
          agent_name:      'signal',
          current_index:   1,
          public_key:      'GSIGNAL',
          last_rotated_at: new Date().toISOString(), // today
          rotation_count:  1,
        },
        error: null,
      });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await service.triggerRotation('signal', false);
      expect(result).toBeNull();
    });

    it('rotates when lastRotatedAt is yesterday (daily schedule)', async () => {
      process.env.AGENT_ROTATION_SCHEDULE = 'daily';
      service = new AgentWalletRotationService();

      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      const oldDerived = makeMockDerived('scribe', 3);
      const newDerived = makeMockDerived('scribe', 4);

      (AgentHDWallet.deriveKeypair as jest.Mock)
        .mockResolvedValueOnce(oldDerived)
        .mockResolvedValueOnce(newDerived);

      const chain = buildSupabaseChain();
      chain.single = jest.fn().mockResolvedValue({
        data: {
          agent_name:      'scribe',
          current_index:   3,
          public_key:      oldDerived.publicKey,
          last_rotated_at: yesterday.toISOString(),
          rotation_count:  3,
        },
        error: null,
      });
      chain.update = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      chain.insert = jest.fn().mockResolvedValue({ error: null });

      (supabase.from as jest.Mock).mockReturnValue(chain);
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      const result = await service.triggerRotation('scribe', false);
      expect(result).not.toBeNull();
      expect(result!.previousIndex).toBe(3);
      expect(result!.newIndex).toBe(4);
    });
  });

  // ── rotateAll ────────────────────────────────────────────────────────────

  describe('rotateAll', () => {
    it('returns results for every successfully rotated agent', async () => {
      process.env.AGENT_ROTATION_SCHEDULE = 'daily';
      service = new AgentWalletRotationService();

      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      // Set up mock so all agents have stale lastRotatedAt
      let callIdx = 0;
      (AgentHDWallet.deriveKeypair as jest.Mock).mockImplementation(
        async (agentName: AgentName, index: number) => makeMockDerived(agentName, index),
      );

      const chain = buildSupabaseChain();
      chain.single = jest.fn().mockImplementation(() => {
        const agents: AgentName[] = ['scout', 'ledger', 'signal', 'scribe', 'executor'];
        const idx = callIdx++ % agents.length;
        return Promise.resolve({
          data: {
            agent_name:      agents[idx],
            current_index:   0,
            public_key:      'GTEST',
            last_rotated_at: yesterday.toISOString(),
            rotation_count:  0,
          },
          error: null,
        });
      });
      chain.update = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      chain.insert = jest.fn().mockResolvedValue({ error: null });

      (supabase.from as jest.Mock).mockReturnValue(chain);
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      const results = await service.rotateAll(true);
      // 5 agents — all should rotate when force=true
      expect(results.length).toBe(5);
    });

    it('does not throw when an individual agent rotation fails', async () => {
      // Make the second agent fail
      let callCount = 0;
      (AgentHDWallet.deriveKeypair as jest.Mock).mockImplementation(
        async (agentName: AgentName, index: number) => {
          callCount++;
          if (callCount === 3) throw new Error('simulated keypair failure');
          return makeMockDerived(agentName, index);
        },
      );

      const chain = buildSupabaseChain();
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      chain.single = jest.fn().mockResolvedValue({
        data: {
          agent_name:      'scout',
          current_index:   0,
          public_key:      'GTEST',
          last_rotated_at: yesterday.toISOString(),
          rotation_count:  0,
        },
        error: null,
      });
      chain.update = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      chain.insert = jest.fn().mockResolvedValue({ error: null });

      (supabase.from as jest.Mock).mockReturnValue(chain);
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      // Should not throw — failures are logged, successful rotations returned
      await expect(service.rotateAll(true)).resolves.toBeDefined();
    });
  });

  // ── getHistory ───────────────────────────────────────────────────────────

  describe('getHistory', () => {
    it('returns history rows for the specified agent', async () => {
      const fakeHistory = [
        { agent_name: 'executor', address_index: 1, public_key: 'G123', recorded_at: new Date().toISOString() },
      ];

      const chain = buildSupabaseChain();
      chain.limit = jest.fn().mockResolvedValue({ data: fakeHistory, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await service.getHistory('executor', 10);
      expect(result).toEqual(fakeHistory);
    });

    it('throws when the DB query fails', async () => {
      const chain = buildSupabaseChain();
      chain.limit = jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(service.getHistory('scout', 10)).rejects.toThrow(/Failed to fetch history/i);
    });
  });

  // ── per-task schedule ────────────────────────────────────────────────────

  describe('per-task schedule', () => {
    it('always invokes triggerRotation when getActiveKeypair is called', async () => {
      process.env.AGENT_ROTATION_SCHEDULE = 'per-task';
      service = new AgentWalletRotationService();

      const triggerSpy = jest
        .spyOn(service, 'triggerRotation')
        .mockResolvedValue({
          agentName:         'scout',
          previousIndex:     0,
          previousPublicKey: 'GOLD',
          newIndex:          1,
          newPublicKey:      'GNEW',
          drainTxHash:       null,
          rotatedAt:         new Date().toISOString(),
        });

      const chain = buildSupabaseChain();
      chain.single = jest.fn().mockResolvedValue({
        data: {
          agent_name:      'scout',
          current_index:   1,
          public_key:      'GNEW',
          last_rotated_at: new Date().toISOString(),
          rotation_count:  1,
        },
        error: null,
      });
      (supabase.from as jest.Mock).mockReturnValue(chain);
      (AgentHDWallet.deriveKeypair as jest.Mock).mockResolvedValue(
        makeMockDerived('scout', 1),
      );

      await service.getActiveKeypair('scout');
      expect(triggerSpy).toHaveBeenCalledWith('scout');
    });
  });
});
