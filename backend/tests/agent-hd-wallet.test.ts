/**
 * Tests for AgentHDWallet — HD key derivation for pipeline agents.
 * Issue #862 — Privacy: Implement address rotation for agent wallets.
 */

import { AgentHDWallet, AgentName, AGENT_NAMES } from '../src/services/agent-hd-wallet';

// Known-good 24-word BIP-39 test mnemonic (from bip39 spec vectors; NOT for production use)
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon art';

jest.mock('../src/services/secret-provider', () => ({
  secretProvider: {
    getSecret: jest.fn().mockResolvedValue(
      'abandon abandon abandon abandon abandon abandon abandon abandon ' +
      'abandon abandon abandon abandon abandon abandon abandon abandon ' +
      'abandon abandon abandon abandon abandon abandon abandon art',
    ),
  },
}));

jest.mock('../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('AgentHDWallet', () => {
  beforeEach(() => {
    // Flush the seed cache between tests so each test gets a fresh derivation
    AgentHDWallet.flushCache();
    jest.clearAllMocks();
  });

  describe('AGENT_NAMES', () => {
    it('exports exactly the five expected agent names', () => {
      expect(AGENT_NAMES).toHaveLength(5);
      expect(AGENT_NAMES).toContain('scout');
      expect(AGENT_NAMES).toContain('ledger');
      expect(AGENT_NAMES).toContain('signal');
      expect(AGENT_NAMES).toContain('scribe');
      expect(AGENT_NAMES).toContain('executor');
    });
  });

  describe('deriveKeypair', () => {
    it('returns a valid DerivedKeypair for each agent at index 0', async () => {
      for (const agentName of AGENT_NAMES) {
        const derived = await AgentHDWallet.deriveKeypair(agentName as AgentName, 0);
        expect(derived.agentName).toBe(agentName);
        expect(derived.addressIndex).toBe(0);
        expect(derived.derivationPath).toBe("m/0'/0'".replace('0', String(AGENT_NAMES.indexOf(agentName as AgentName))));
        expect(derived.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
        expect(derived.keypair).toBeDefined();
      }
    });

    it('produces different public keys for different agents at the same index', async () => {
      const keys = await Promise.all(
        AGENT_NAMES.map((name) => AgentHDWallet.deriveKeypair(name as AgentName, 0)),
      );
      const pubKeys = keys.map((k) => k.publicKey);
      const unique = new Set(pubKeys);
      expect(unique.size).toBe(AGENT_NAMES.length);
    });

    it('produces different public keys for the same agent at different indices', async () => {
      const k0 = await AgentHDWallet.deriveKeypair('scout', 0);
      const k1 = await AgentHDWallet.deriveKeypair('scout', 1);
      const k2 = await AgentHDWallet.deriveKeypair('scout', 2);

      expect(k0.publicKey).not.toBe(k1.publicKey);
      expect(k1.publicKey).not.toBe(k2.publicKey);
      expect(k0.publicKey).not.toBe(k2.publicKey);
    });

    it('is deterministic — same inputs produce same outputs', async () => {
      const first  = await AgentHDWallet.deriveKeypair('ledger', 5);
      AgentHDWallet.flushCache();
      const second = await AgentHDWallet.deriveKeypair('ledger', 5);

      expect(first.publicKey).toBe(second.publicKey);
      expect(first.derivationPath).toBe(second.derivationPath);
    });

    it('throws for an unknown agent name', async () => {
      await expect(
        AgentHDWallet.deriveKeypair('unknown' as AgentName, 0),
      ).rejects.toThrow(/unknown agent name/i);
    });

    it('throws for a negative address index', async () => {
      await expect(
        AgentHDWallet.deriveKeypair('scout', -1),
      ).rejects.toThrow(/non-negative integer/i);
    });

    it('throws for a fractional address index', async () => {
      await expect(
        AgentHDWallet.deriveKeypair('scout', 1.5),
      ).rejects.toThrow(/non-negative integer/i);
    });

    it('includes correct address index in derivation path', async () => {
      const derived = await AgentHDWallet.deriveKeypair('executor', 7);
      // executor role index = 4; address index = 7
      expect(derived.derivationPath).toBe("m/4'/7'");
    });

    it('handles large address indices without error', async () => {
      const derived = await AgentHDWallet.deriveKeypair('scout', 9999);
      expect(derived.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
    });
  });

  describe('deriveCurrentKeypair', () => {
    it('delegates to deriveKeypair with the given index', async () => {
      const via_current = await AgentHDWallet.deriveCurrentKeypair('signal', 3);
      const via_direct  = await AgentHDWallet.deriveKeypair('signal', 3);
      expect(via_current.publicKey).toBe(via_direct.publicKey);
    });
  });

  describe('flushCache', () => {
    it('allows re-loading the seed without error', async () => {
      // Prime the cache
      await AgentHDWallet.deriveKeypair('scout', 0);
      // Flush it
      AgentHDWallet.flushCache();
      // Should re-load cleanly
      const derived = await AgentHDWallet.deriveKeypair('scout', 0);
      expect(derived.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
    });
  });

  describe('missing AGENT_MASTER_SEED', () => {
    beforeEach(() => {
      AgentHDWallet.flushCache();
      const { secretProvider } = require('../src/services/secret-provider');
      (secretProvider.getSecret as jest.Mock).mockResolvedValueOnce(undefined);
    });

    it('throws a descriptive error when AGENT_MASTER_SEED is not set', async () => {
      await expect(AgentHDWallet.deriveKeypair('scout', 0)).rejects.toThrow(
        /AGENT_MASTER_SEED is not configured/i,
      );
    });
  });

  describe('invalid mnemonic', () => {
    beforeEach(() => {
      AgentHDWallet.flushCache();
      const { secretProvider } = require('../src/services/secret-provider');
      (secretProvider.getSecret as jest.Mock).mockResolvedValueOnce('not a real mnemonic at all');
    });

    it('throws a descriptive error for an invalid mnemonic', async () => {
      await expect(AgentHDWallet.deriveKeypair('scout', 0)).rejects.toThrow(
        /not a valid BIP-39 mnemonic/i,
      );
    });
  });
});
