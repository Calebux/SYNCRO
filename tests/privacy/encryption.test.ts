import { describe, it, expect } from 'vitest';
import {
  encryptMetadata,
  decryptMetadata,
} from '../../shared/src/crypto/metadata-encryption';

describe('Privacy Integration: Encrypted Storage', () => {
  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const subscriptionData = JSON.stringify({
    name: 'Netflix Premium',
    price: 15.99,
    cycle: 'monthly',
    provider: 'Netflix',
    startDate: '2025-01-15',
    category: 'entertainment',
  });

  it('should encrypt subscription data so on-chain representation is opaque', async () => {
    const encrypted = await encryptMetadata(subscriptionData, encryptionKey);

    expect(encrypted.ciphertext).not.toContain('Netflix');
    expect(encrypted.ciphertext).not.toContain('15.99');
    expect(encrypted.ciphertext).not.toContain('monthly');

    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.ciphertext).toBeDefined();
  });

  it('should decrypt locally to reveal original data', async () => {
    const encrypted = await encryptMetadata(subscriptionData, encryptionKey);
    const decrypted = await decryptMetadata(encrypted, encryptionKey);
    const parsed = JSON.parse(decrypted);

    expect(parsed.name).toBe('Netflix Premium');
    expect(parsed.price).toBe(15.99);
    expect(parsed.cycle).toBe('monthly');
    expect(parsed.provider).toBe('Netflix');
  });

  it('should produce different ciphertext for same plaintext (nonce uniqueness)', async () => {
    const encrypted1 = await encryptMetadata(subscriptionData, encryptionKey);
    const encrypted2 = await encryptMetadata(subscriptionData, encryptionKey);

    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
  });

  it('should reject decryption with wrong key', async () => {
    const encrypted = await encryptMetadata(subscriptionData, encryptionKey);
    const wrongKey = 'ff'.repeat(32);

    await expect(decryptMetadata(encrypted, wrongKey)).rejects.toThrow();
  });

  it('should reject tampered ciphertext', async () => {
    const encrypted = await encryptMetadata(subscriptionData, encryptionKey);
    const tampered = {
      ...encrypted,
      ciphertext: 'ff' + encrypted.ciphertext.slice(2),
    };

    await expect(decryptMetadata(tampered, encryptionKey)).rejects.toThrow();
  });

  it('should simulate full encrypted storage lifecycle', async () => {
    const subscriptions = [
      { name: 'Netflix', price: 15.99, cycle: 'monthly' },
      { name: 'Spotify', price: 9.99, cycle: 'monthly' },
      { name: 'Adobe CC', price: 54.99, cycle: 'yearly' },
    ];

    const encryptedStore: Array<{ id: string; data: Awaited<ReturnType<typeof encryptMetadata>> }> = [];

    for (const sub of subscriptions) {
      const encrypted = await encryptMetadata(JSON.stringify(sub), encryptionKey);
      encryptedStore.push({ id: `sub_${sub.name.toLowerCase()}`, data: encrypted });
    }

    for (let i = 0; i < encryptedStore.length; i++) {
      const { data } = encryptedStore[i];
      expect(data.ciphertext).not.toContain(subscriptions[i].name);
    }

    for (let i = 0; i < encryptedStore.length; i++) {
      const decrypted = await decryptMetadata(encryptedStore[i].data, encryptionKey);
      const parsed = JSON.parse(decrypted);
      expect(parsed.name).toBe(subscriptions[i].name);
      expect(parsed.price).toBe(subscriptions[i].price);
    }
  });
});
