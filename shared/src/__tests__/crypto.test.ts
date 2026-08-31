import {
  deriveKey,
  deriveKeyHex,
  deriveSubscriptionEncryptionKey,
  encryptMetadata,
  decryptMetadata,
  encryptSubscriptionMetadata,
  decryptSubscriptionMetadata,
  ed25519ToCurve25519PubKey,
  ed25519ToCurve25519SecKey,
  deriveStealthAddress,
  commit,
  verify,
  buildMerkleTree,
  getMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
  createPaymentCommitment,
  verifyPaymentCommitment,
} from '../crypto';
import type { SubscriptionMetadata, EncryptedData } from '../crypto';

describe('Crypto Utilities', () => {
  describe('Key Derivation (HKDF)', () => {
    it('should derive a key from input material', () => {
      const ikm = new Uint8Array([1, 2, 3, 4, 5]);
      const derived = deriveKey(ikm);
      expect(derived.length).toBe(32);
    });

    it('should derive same key for same inputs', () => {
      const ikm = '0102030405';
      const derived1 = deriveKeyHex(ikm);
      const derived2 = deriveKeyHex(ikm);
      expect(derived1).toBe(derived2);
    });
  });

  describe('deriveSubscriptionEncryptionKey', () => {
    const seed = new Uint8Array(32).fill(0xab);

    it('returns a 64-char hex string (256-bit key)', () => {
      const key = deriveSubscriptionEncryptionKey(seed);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic — same seed always yields the same key', () => {
      const key1 = deriveSubscriptionEncryptionKey(seed);
      const key2 = deriveSubscriptionEncryptionKey(seed);
      expect(key1).toBe(key2);
    });

    it('different seeds yield different keys', () => {
      const seed2 = new Uint8Array(32).fill(0xcd);
      expect(deriveSubscriptionEncryptionKey(seed)).not.toBe(
        deriveSubscriptionEncryptionKey(seed2),
      );
    });

    it('rejects seeds that are not exactly 32 bytes', () => {
      expect(() => deriveSubscriptionEncryptionKey(new Uint8Array(16))).toThrow();
      expect(() => deriveSubscriptionEncryptionKey(new Uint8Array(33))).toThrow();
    });
  });

  describe('Metadata Encryption', () => {
    it('should encrypt and decrypt metadata', async () => {
      const key = 'a'.repeat(64); // 32-byte key as hex
      const plaintext = 'Hello, World!';
      const encrypted = await encryptMetadata(plaintext, key);
      const decrypted = await decryptMetadata(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('Subscription Metadata Encryption', () => {
    const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const testMetadata: SubscriptionMetadata = {
      name: 'Netflix Premium',
      price: 15.99,
      cycle: 'monthly',
      provider: 'Netflix',
    };

    it('should round-trip encrypt and decrypt preserving all fields', async () => {
      const encrypted = await encryptSubscriptionMetadata(testKey, testMetadata);
      const decrypted = await decryptSubscriptionMetadata(testKey, encrypted);
      expect(decrypted).toEqual(testMetadata);
    });

    it('should reject tampered ciphertext (authentication tag check)', async () => {
      const encrypted = await encryptSubscriptionMetadata(testKey, testMetadata);
      const tampered: EncryptedData = {
        ...encrypted,
        ciphertext: 'ff' + encrypted.ciphertext.slice(2),
      };
      await expect(decryptSubscriptionMetadata(testKey, tampered)).rejects.toThrow();
    });

    it('should reject tampered auth tag', async () => {
      const encrypted = await encryptSubscriptionMetadata(testKey, testMetadata);
      const tampered: EncryptedData = {
        ...encrypted,
        authTag: 'ff' + encrypted.authTag.slice(2),
      };
      await expect(decryptSubscriptionMetadata(testKey, tampered)).rejects.toThrow();
    });

    it('should produce unique nonce per encryption call', async () => {
      const encrypted1 = await encryptSubscriptionMetadata(testKey, testMetadata);
      const encrypted2 = await encryptSubscriptionMetadata(testKey, testMetadata);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should preserve all metadata field types after decryption', async () => {
      const metadata: SubscriptionMetadata = {
        name: 'Spotify Family',
        price: 16.99,
        cycle: 'monthly',
        provider: 'Spotify',
      };
      const encrypted = await encryptSubscriptionMetadata(testKey, metadata);
      const decrypted = await decryptSubscriptionMetadata(testKey, encrypted);
      expect(typeof decrypted.name).toBe('string');
      expect(typeof decrypted.price).toBe('number');
      expect(typeof decrypted.cycle).toBe('string');
      expect(typeof decrypted.provider).toBe('string');
    });

    it('should support all valid cycle values', async () => {
      const cycles: SubscriptionMetadata['cycle'][] = ['weekly', 'monthly', 'quarterly', 'yearly'];
      for (const cycle of cycles) {
        const metadata: SubscriptionMetadata = { name: 'Test', price: 10, cycle, provider: 'Test' };
        const encrypted = await encryptSubscriptionMetadata(testKey, metadata);
        const decrypted = await decryptSubscriptionMetadata(testKey, encrypted);
        expect(decrypted.cycle).toBe(cycle);
      }
    });

    it('should reject decryption with wrong key', async () => {
      const wrongKey = 'ff'.repeat(32);
      const encrypted = await encryptSubscriptionMetadata(testKey, testMetadata);
      await expect(decryptSubscriptionMetadata(wrongKey, encrypted)).rejects.toThrow();
    });
  });

  describe('Pedersen Commitments', () => {
    it('should create and verify a commitment', () => {
      const value = 100n;
      const { commitment, blindingFactor } = commit(value);
      const isValid = verify(value, BigInt('0x' + blindingFactor), commitment);
      expect(isValid).toBe(true);
    });

    it('should fail verification for wrong value', () => {
      const value = 100n;
      const { commitment, blindingFactor } = commit(value);
      const isValid = verify(200n, BigInt('0x' + blindingFactor), commitment);
      expect(isValid).toBe(false);
    });
  });

  describe('Merkle Tree', () => {
    const leaves = ['a', 'b', 'c', 'd'];

    it('should build a Merkle tree and get root', () => {
      const tree = buildMerkleTree(leaves);
      const root = getMerkleRoot(leaves);
      expect(tree[tree.length - 1][0]).toBe(root);
    });

    it('should generate and verify a Merkle proof', () => {
      const proof = generateMerkleProof(leaves, 1);
      const isValid = verifyMerkleProof(proof);
      expect(isValid).toBe(true);
    });
  });

  describe('Payment Commitment', () => {
    it('should create and verify a payment commitment', () => {
      const amount = 500n;
      const commitment = createPaymentCommitment(amount);
      const isValid = verifyPaymentCommitment(amount, commitment);
      expect(isValid).toBe(true);
    });
  });
});
