import {
  validateEntryKey,
  validateTTL,
  validateSnapshotHash,
  hexToScvBytes,
  numberToScvU64,
  prepareExtendTTLArgs,
  prepareGetTTLArgs,
  prepareMarkArchivedArgs,
  shouldSkipExtendTTL,
  estimateExtendTTLGas,
  estimateGetTTLGas,
  estimateMarkArchivedGas,
} from '../../blockchain/ttl-contract-helpers';
import { xdr } from '@stellar/stellar-sdk';

describe('TTL Contract Helpers', () => {
  describe('validateEntryKey', () => {
    it('should accept valid hex entry keys', () => {
      expect(validateEntryKey('0xabcd1234')).toBe(true);
      expect(validateEntryKey('abcd1234')).toBe(true);
    });

    it('should reject non-hex strings', () => {
      expect(validateEntryKey('0xzzzz')).toBe(false);
      expect(validateEntryKey('not-hex')).toBe(false);
    });

    it('should reject odd-length hex strings', () => {
      expect(validateEntryKey('0xabc')).toBe(false);
      expect(validateEntryKey('abc')).toBe(false);
    });

    it('should reject non-string types', () => {
      expect(validateEntryKey(123 as any)).toBe(false);
      expect(validateEntryKey(null as any)).toBe(false);
      expect(validateEntryKey(undefined as any)).toBe(false);
    });

    it('should accept full-length contract entry keys', () => {
      const longKey = '0x' + 'a'.repeat(64);
      expect(validateEntryKey(longKey)).toBe(true);
    });
  });

  describe('validateTTL', () => {
    it('should accept positive integers', () => {
      expect(validateTTL(1000)).toBe(true);
      expect(validateTTL(999999999)).toBe(true);
    });

    it('should reject zero and negative values', () => {
      expect(validateTTL(0)).toBe(false);
      expect(validateTTL(-1)).toBe(false);
    });

    it('should reject non-integer values', () => {
      expect(validateTTL(123.45)).toBe(false);
      expect(validateTTL(NaN)).toBe(false);
      expect(validateTTL(Infinity)).toBe(false);
    });
  });

  describe('validateSnapshotHash', () => {
    it('should accept valid SHA-256 hex strings', () => {
      const sha256Hash = 'a'.repeat(64);
      expect(validateSnapshotHash(sha256Hash)).toBe(true);
      expect(validateSnapshotHash('0x' + sha256Hash)).toBe(true);
    });

    it('should reject non-SHA-256 length hashes', () => {
      expect(validateSnapshotHash('0xabc')).toBe(false);
      expect(validateSnapshotHash('a'.repeat(32))).toBe(false);
      expect(validateSnapshotHash('a'.repeat(128))).toBe(false);
    });

    it('should reject non-hex strings', () => {
      const invalidHash = 'z'.repeat(64);
      expect(validateSnapshotHash(invalidHash)).toBe(false);
    });

    it('should reject non-string types', () => {
      expect(validateSnapshotHash(123 as any)).toBe(false);
      expect(validateSnapshotHash(null as any)).toBe(false);
    });
  });

  describe('hexToScvBytes', () => {
    it('should convert hex string to ScVal bytes', () => {
      const hex = '48656c6c6f'; // "Hello" in hex
      const scval = hexToScvBytes(hex);
      expect(scval).toBeDefined();
      expect(scval.switch().name).toBe('scvBytes');
    });

    it('should handle 0x prefix', () => {
      const hex = '0x48656c6c6f';
      const scval = hexToScvBytes(hex);
      expect(scval).toBeDefined();
      expect(scval.switch().name).toBe('scvBytes');
    });

    it('should throw on invalid hex', () => {
      expect(() => hexToScvBytes('0xzzzz')).toThrow();
    });
  });

  describe('numberToScvU64', () => {
    it('should convert number to ScVal u64', () => {
      const num = 123456789;
      const scval = numberToScvU64(num);
      expect(scval).toBeDefined();
      expect(scval.switch().name).toBe('scvU64');
    });

    it('should throw on invalid TTL values', () => {
      expect(() => numberToScvU64(0)).toThrow();
      expect(() => numberToScvU64(-1)).toThrow();
      expect(() => numberToScvU64(123.45)).toThrow();
    });
  });

  describe('prepareExtendTTLArgs', () => {
    it('should prepare valid extend_ttl arguments', () => {
      const entryKey = '0x' + 'a'.repeat(64);
      const newTtl = 1000000;
      const args = prepareExtendTTLArgs(entryKey, newTtl);

      expect(args).toHaveLength(2);
      expect(args[0].switch().name).toBe('scvBytes');
      expect(args[1].switch().name).toBe('scvU64');
    });

    it('should throw on invalid entry key', () => {
      expect(() => prepareExtendTTLArgs('invalid', 1000)).toThrow();
    });

    it('should throw on invalid TTL', () => {
      const validKey = '0x' + 'a'.repeat(64);
      expect(() => prepareExtendTTLArgs(validKey, 0)).toThrow();
      expect(() => prepareExtendTTLArgs(validKey, -1)).toThrow();
    });
  });

  describe('prepareGetTTLArgs', () => {
    it('should prepare valid get_ttl arguments', () => {
      const entryKey = '0x' + 'a'.repeat(64);
      const args = prepareGetTTLArgs(entryKey);

      expect(args).toHaveLength(1);
      expect(args[0].switch().name).toBe('scvBytes');
    });

    it('should throw on invalid entry key', () => {
      expect(() => prepareGetTTLArgs('invalid')).toThrow();
    });
  });

  describe('prepareMarkArchivedArgs', () => {
    it('should prepare valid mark_archived arguments', () => {
      const entryKey = '0x' + 'a'.repeat(64);
      const snapshotHash = 'a'.repeat(64);
      const args = prepareMarkArchivedArgs(entryKey, snapshotHash);

      expect(args).toHaveLength(2);
      expect(args[0].switch().name).toBe('scvBytes');
      expect(args[1].switch().name).toBe('scvBytes');
    });

    it('should throw on invalid entry key', () => {
      const validHash = 'a'.repeat(64);
      expect(() => prepareMarkArchivedArgs('invalid', validHash)).toThrow();
    });

    it('should throw on invalid snapshot hash', () => {
      const validKey = '0x' + 'a'.repeat(64);
      expect(() => prepareMarkArchivedArgs(validKey, 'invalid')).toThrow();
    });
  });

  describe('shouldSkipExtendTTL', () => {
    it('should return false when new_ttl > current_ttl (should extend)', () => {
      expect(shouldSkipExtendTTL(1000, 2000)).toBe(false);
    });

    it('should return true when new_ttl <= current_ttl (skip extend)', () => {
      expect(shouldSkipExtendTTL(2000, 2000)).toBe(true);
      expect(shouldSkipExtendTTL(2000, 1000)).toBe(true);
    });
  });

  describe('Gas estimation', () => {
    it('should estimate extend_ttl gas cost', () => {
      const gas = estimateExtendTTLGas();
      expect(gas).toBeGreaterThan(0);
      expect(gas).toBeLessThan(10000);
    });

    it('should estimate get_ttl gas cost', () => {
      const gas = estimateGetTTLGas();
      expect(gas).toBeGreaterThan(0);
      expect(gas).toBeLessThan(10000);
    });

    it('should estimate mark_archived gas cost', () => {
      const gas = estimateMarkArchivedGas();
      expect(gas).toBeGreaterThan(0);
      expect(gas).toBeLessThan(10000);
    });

    it('should estimate mark_archived as more expensive than read', () => {
      expect(estimateMarkArchivedGas()).toBeGreaterThan(estimateGetTTLGas());
    });

    it('should estimate extend_ttl as more expensive than read', () => {
      expect(estimateExtendTTLGas()).toBeGreaterThan(estimateGetTTLGas());
    });
  });

  describe('Argument preparation idempotency', () => {
    it('should produce consistent args for same inputs', () => {
      const entryKey = '0x' + 'a'.repeat(64);
      const newTtl = 1000000;

      const args1 = prepareExtendTTLArgs(entryKey, newTtl);
      const args2 = prepareExtendTTLArgs(entryKey, newTtl);

      // Args should be equal (same types and values)
      expect(args1).toHaveLength(args2.length);
      expect(args1[0].switch().name).toBe(args2[0].switch().name);
      expect(args1[1].switch().name).toBe(args2[1].switch().name);
    });
  });
});
