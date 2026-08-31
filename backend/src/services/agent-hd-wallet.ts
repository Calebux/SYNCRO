/**
 * agent-hd-wallet.ts
 *
 * HD (Hierarchical Deterministic) wallet derivation for pipeline agents.
 *
 * Implements Issue #862 — Privacy: Implement address rotation for agent wallets.
 *
 * Design:
 *  - A single BIP-39 mnemonic (AGENT_MASTER_SEED) is stored as a secret.
 *  - Each agent role (Scout, Ledger, Signal, Scribe, Executor) has its own
 *    derivation path namespace so that their addresses never overlap.
 *  - Within each role, an incrementing index `n` produces a fresh keypair:
 *      m / role_index' / n'
 *    where role_index is a fixed integer per agent name.
 *  - The derived seed bytes are hashed with HMAC-SHA256 keyed to "ed25519 seed"
 *    following the SLIP-0010 convention for Ed25519 key derivation, producing
 *    a 32-byte secret scalar that is used directly as a Stellar secret key.
 *
 * Dependencies already present in package.json:
 *   - bip39   (mnemonic → seed)
 *   - @stellar/stellar-sdk  (Keypair)
 *   - Node.js crypto (HMAC)
 */

import crypto from 'crypto';
import * as bip39 from 'bip39';
import { Keypair } from '@stellar/stellar-sdk';
import logger from '../config/logger';
import { secretProvider } from './secret-provider';

// ─── Agent role registry ──────────────────────────────────────────────────────

/** All recognised pipeline agent names. */
export type AgentName = 'scout' | 'ledger' | 'signal' | 'scribe' | 'executor';

/** Stable numeric index per agent (must never change — changing breaks derivation). */
const AGENT_ROLE_INDEX: Record<AgentName, number> = {
  scout:    0,
  ledger:   1,
  signal:   2,
  scribe:   3,
  executor: 4,
};

export const AGENT_NAMES = Object.keys(AGENT_ROLE_INDEX) as AgentName[];

// ─── SLIP-0010 Ed25519 HD derivation ─────────────────────────────────────────

/**
 * Derives a child key from a parent key using SLIP-0010 for Ed25519.
 * All indices are treated as hardened (index | 0x80000000).
 *
 * @param parentKey   32-byte private key
 * @param parentChain 32-byte chain code
 * @param index       Child index (unhardened value; hardening applied internally)
 */
function deriveChildKey(
  parentKey: Buffer,
  parentChain: Buffer,
  index: number,
): { key: Buffer; chainCode: Buffer } {
  const hardenedIndex = (index | 0x80000000) >>> 0;
  const data = Buffer.allocUnsafe(37);
  data[0] = 0x00;
  parentKey.copy(data, 1);
  data.writeUInt32BE(hardenedIndex, 33);

  const hmac = crypto.createHmac('sha512', parentChain);
  hmac.update(data);
  const result = hmac.digest();

  return {
    key:       result.subarray(0, 32),
    chainCode: result.subarray(32),
  };
}

/**
 * Derives a root key from a BIP-39 seed using the SLIP-0010 master key
 * derivation with the "ed25519 seed" curve string.
 */
function deriveRootKey(seed: Buffer): { key: Buffer; chainCode: Buffer } {
  const hmac = crypto.createHmac('sha512', Buffer.from('ed25519 seed', 'utf8'));
  hmac.update(seed);
  const result = hmac.digest();
  return {
    key:       result.subarray(0, 32),
    chainCode: result.subarray(32),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Result of a keypair derivation. */
export interface DerivedKeypair {
  agentName: AgentName;
  /** BIP-32 style derivation path (informational) */
  derivationPath: string;
  /** Address index — incremented on each rotation */
  addressIndex: number;
  keypair: Keypair;
  publicKey: string;
}

/**
 * AgentHDWallet
 *
 * Stateless HD wallet that derives Stellar keypairs for pipeline agents from a
 * BIP-39 mnemonic.  The master seed is fetched once per process lifetime and
 * cached in memory; it is never logged or persisted.
 */
export class AgentHDWallet {
  private static _seedCache: Buffer | null = null;

  /**
   * Fetches and caches the master seed from the secret provider.
   * Throws if AGENT_MASTER_SEED is missing.
   */
  private static async getMasterSeed(): Promise<Buffer> {
    if (AgentHDWallet._seedCache) {
      return AgentHDWallet._seedCache;
    }

    const mnemonic = await secretProvider.getSecret('AGENT_MASTER_SEED');
    if (!mnemonic) {
      throw new Error(
        '[AgentHDWallet] AGENT_MASTER_SEED is not configured. ' +
          'Generate one with: node -e "const b=require(\'bip39\');console.log(b.generateMnemonic(256))"',
      );
    }

    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error(
        '[AgentHDWallet] AGENT_MASTER_SEED is not a valid BIP-39 mnemonic.',
      );
    }

    const seed = await bip39.mnemonicToSeed(mnemonic);
    AgentHDWallet._seedCache = seed;
    logger.info('[AgentHDWallet] Master seed loaded successfully (not logged)');
    return seed;
  }

  /**
   * Flushes the in-memory seed cache.
   * Call this after rotation is complete if you want to minimise the window
   * during which the seed is in memory (optional, defensive).
   */
  static flushCache(): void {
    AgentHDWallet._seedCache = null;
  }

  /**
   * Derives the Stellar keypair for a given agent role and address index.
   *
   * Derivation path: m / role_index' / address_index'
   *
   * @param agentName    One of the five pipeline agent names.
   * @param addressIndex Address index (0 = genesis, n = nth rotation).
   */
  static async deriveKeypair(
    agentName: AgentName,
    addressIndex: number,
  ): Promise<DerivedKeypair> {
    const roleIndex = AGENT_ROLE_INDEX[agentName];
    if (roleIndex === undefined) {
      throw new Error(`[AgentHDWallet] Unknown agent name: ${agentName}`);
    }
    if (!Number.isInteger(addressIndex) || addressIndex < 0) {
      throw new Error(
        `[AgentHDWallet] addressIndex must be a non-negative integer, got: ${addressIndex}`,
      );
    }

    const seed = await AgentHDWallet.getMasterSeed();
    const root = deriveRootKey(seed);
    const roleLevel = deriveChildKey(root.key, root.chainCode, roleIndex);
    const addressLevel = deriveChildKey(roleLevel.key, roleLevel.chainCode, addressIndex);

    const keypair = Keypair.fromRawEd25519Seed(addressLevel.key);
    const derivationPath = `m/${roleIndex}'/${addressIndex}'`;

    logger.debug('[AgentHDWallet] Derived keypair', {
      agentName,
      addressIndex,
      derivationPath,
      publicKey: keypair.publicKey(),
    });

    return {
      agentName,
      derivationPath,
      addressIndex,
      keypair,
      publicKey: keypair.publicKey(),
    };
  }

  /**
   * Derives the current active keypair for a given agent name.
   * "Current" is resolved by the caller via AgentWalletRotationService.
   */
  static async deriveCurrentKeypair(
    agentName: AgentName,
    currentAddressIndex: number,
  ): Promise<DerivedKeypair> {
    return AgentHDWallet.deriveKeypair(agentName, currentAddressIndex);
  }
}
