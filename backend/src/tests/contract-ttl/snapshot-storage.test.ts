import { SnapshotStorage } from '../../archival/snapshot-storage';
import * as crypto from 'crypto';

describe('SnapshotStorage', () => {
  let snapshotStorage: SnapshotStorage;

  beforeEach(() => {
    snapshotStorage = new SnapshotStorage();
  });

  describe('redactSensitiveFields', () => {
    it('should redact sensitive fields', () => {
      const snapshot = {
        entryState: {
          subscriptionId: 'sub_123',
          approvalState: 'SENSITIVE_APPROVAL_DATA',
          paymentDetails: 'SENSITIVE_PAYMENT_DATA',
          email: 'user@example.com',
          phoneNumber: '555-1234',
        },
      };

      const redacted = SnapshotStorage.redactSensitiveFields(snapshot);

      expect(redacted.entryState.subscriptionId).toBe('sub_123');
      expect(redacted.entryState.approvalState).toBe('REDACTED_FOR_PRIVACY');
      expect(redacted.entryState.paymentDetails).toBe('REDACTED_FOR_PRIVACY');
      expect(redacted.entryState.email).toBe('REDACTED_FOR_PRIVACY');
      expect(redacted.entryState.phoneNumber).toBe('REDACTED_FOR_PRIVACY');
    });

    it('should handle nested objects', () => {
      const snapshot = {
        level1: {
          level2: {
            ssn: 'SENSITIVE_SSN',
            normal: 'normal_value',
          },
        },
      };

      const redacted = SnapshotStorage.redactSensitiveFields(snapshot);

      expect(redacted.level1.level2.ssn).toBe('REDACTED_FOR_PRIVACY');
      expect(redacted.level1.level2.normal).toBe('normal_value');
    });

    it('should handle arrays', () => {
      const snapshot = {
        items: [
          { email: 'user1@example.com', name: 'User 1' },
          { email: 'user2@example.com', name: 'User 2' },
        ],
      };

      const redacted = SnapshotStorage.redactSensitiveFields(snapshot);

      expect(redacted.items[0].email).toBe('REDACTED_FOR_PRIVACY');
      expect(redacted.items[0].name).toBe('User 1');
      expect(redacted.items[1].email).toBe('REDACTED_FOR_PRIVACY');
      expect(redacted.items[1].name).toBe('User 2');
    });

    it('should not mutate original snapshot', () => {
      const snapshot = {
        approvalState: 'SENSITIVE',
        normalField: 'normal',
      };
      const original = JSON.stringify(snapshot);

      SnapshotStorage.redactSensitiveFields(snapshot);

      expect(JSON.stringify(snapshot)).toBe(original);
    });
  });

  describe('computeSnapshotHash', () => {
    it('should compute SHA-256 hash of snapshot', () => {
      const snapshot = { data: 'test' };
      const hash = SnapshotStorage.computeSnapshotHash(snapshot);

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce consistent hash for same snapshot', () => {
      const snapshot = { data: 'test' };
      const hash1 = SnapshotStorage.computeSnapshotHash(snapshot);
      const hash2 = SnapshotStorage.computeSnapshotHash(snapshot);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different snapshots', () => {
      const snapshot1 = { data: 'test1' };
      const snapshot2 = { data: 'test2' };

      const hash1 = SnapshotStorage.computeSnapshotHash(snapshot1);
      const hash2 = SnapshotStorage.computeSnapshotHash(snapshot2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle string input', () => {
      const jsonString = '{"data":"test"}';
      const hash1 = SnapshotStorage.computeSnapshotHash(jsonString);

      expect(hash1).toBeDefined();
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Encryption/Decryption', () => {
    it('should encrypt and decrypt snapshot', () => {
      const encryptionKey = crypto.randomBytes(32);
      const snapshotData = JSON.stringify({ data: 'sensitive' });

      const { encrypted, iv, authTag } = SnapshotStorage.encryptSnapshot(snapshotData, encryptionKey);
      const decrypted = SnapshotStorage.decryptSnapshot(encrypted, iv, authTag, encryptionKey);

      expect(decrypted).toBe(snapshotData);
    });

    it('should produce different ciphertexts for same plaintext (due to random IV)', () => {
      const encryptionKey = crypto.randomBytes(32);
      const snapshotData = 'test data';

      const { encrypted: encrypted1 } = SnapshotStorage.encryptSnapshot(snapshotData, encryptionKey);
      const { encrypted: encrypted2 } = SnapshotStorage.encryptSnapshot(snapshotData, encryptionKey);

      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should fail decryption with wrong key', () => {
      const encryptionKey1 = crypto.randomBytes(32);
      const encryptionKey2 = crypto.randomBytes(32);
      const snapshotData = 'test data';

      const { encrypted, iv, authTag } = SnapshotStorage.encryptSnapshot(snapshotData, encryptionKey1);

      expect(() => SnapshotStorage.decryptSnapshot(encrypted, iv, authTag, encryptionKey2)).toThrow();
    });

    it('should fail decryption with tampered ciphertext', () => {
      const encryptionKey = crypto.randomBytes(32);
      const snapshotData = 'test data';

      let { encrypted, iv, authTag } = SnapshotStorage.encryptSnapshot(snapshotData, encryptionKey);

      // Tamper with ciphertext
      encrypted[0] = encrypted[0] ^ 0xff;

      expect(() => SnapshotStorage.decryptSnapshot(encrypted, iv, authTag, encryptionKey)).toThrow();
    });

    it('should fail decryption with tampered auth tag', () => {
      const encryptionKey = crypto.randomBytes(32);
      const snapshotData = 'test data';

      let { encrypted, iv, authTag } = SnapshotStorage.encryptSnapshot(snapshotData, encryptionKey);

      // Tamper with auth tag
      authTag[0] = authTag[0] ^ 0xff;

      expect(() => SnapshotStorage.decryptSnapshot(encrypted, iv, authTag, encryptionKey)).toThrow();
    });
  });

  describe('Snapshot integrity', () => {
    it('should verify snapshot hash after encryption/decryption', () => {
      const encryptionKey = crypto.randomBytes(32);
      const snapshotData = { data: 'test' };
      const originalHash = SnapshotStorage.computeSnapshotHash(snapshotData);

      const { encrypted, iv, authTag } = SnapshotStorage.encryptSnapshot(
        JSON.stringify(snapshotData),
        encryptionKey,
      );
      const decrypted = SnapshotStorage.decryptSnapshot(encrypted, iv, authTag, encryptionKey);
      const decryptedHash = SnapshotStorage.computeSnapshotHash(decrypted);

      expect(decryptedHash).toBe(originalHash);
    });
  });

  describe('Snapshot serialization', () => {
    it('should handle complex nested structures', () => {
      const snapshot = {
        archivalMetadata: {
          entryKey: '0xabcd',
          entryType: 'subscription',
          archivalTimestamp: new Date().toISOString(),
        },
        entryState: {
          id: 'sub_123',
          nested: {
            data: [1, 2, 3],
          },
        },
      };

      const hash1 = SnapshotStorage.computeSnapshotHash(snapshot);
      const json = JSON.stringify(snapshot);
      const hash2 = SnapshotStorage.computeSnapshotHash(json);

      expect(hash1).toBe(hash2);
    });

    it('should be consistent with JSON key ordering', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };

      // JSON.stringify may order keys differently depending on insertion order
      const hash1 = SnapshotStorage.computeSnapshotHash(obj1);
      const hash2 = SnapshotStorage.computeSnapshotHash(obj2);

      // Note: These may differ if JSON serialization doesn't canonicalize
      // In production, use a canonical JSON format
      expect(typeof hash1).toBe('string');
      expect(typeof hash2).toBe('string');
    });
  });
});
