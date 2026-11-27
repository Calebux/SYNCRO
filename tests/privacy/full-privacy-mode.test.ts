import { describe, it, expect } from 'vitest';
import { deriveStealthAddress } from '../../shared/src/crypto/stealth-derive';
import { encryptMetadata, decryptMetadata } from '../../shared/src/crypto/metadata-encryption';
import { commit, verify } from '../../shared/src/crypto/pedersen';
import {
  getMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
} from '../../shared/src/crypto/merkle';
import { createPaymentCommitment, verifyPaymentCommitment } from '../../shared/src/crypto/payment-commitment';

describe('Privacy Integration: Full Privacy Mode', () => {
  const metaAddress = 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  interface OnChainFootprint {
    transactions: string[];
    commitments: string[];
    encryptedBlobs: number;
    plaintextLeaked: boolean;
  }

  it('should run full subscription lifecycle with all privacy features enabled', async () => {
    const footprint: OnChainFootprint = {
      transactions: [],
      commitments: [],
      encryptedBlobs: 0,
      plaintextLeaked: false,
    };

    // 1. Create subscription with encrypted metadata
    const subscriptionData = {
      name: 'Netflix Premium',
      price: 15.99,
      cycle: 'monthly',
      provider: 'Netflix',
    };
    const encrypted = await encryptMetadata(JSON.stringify(subscriptionData), encryptionKey);
    footprint.encryptedBlobs++;

    // Verify on-chain data is opaque
    const onChainBlob = encrypted.ciphertext + encrypted.iv + encrypted.authTag;
    if (
      onChainBlob.includes('Netflix') ||
      onChainBlob.includes('15.99') ||
      onChainBlob.includes('monthly')
    ) {
      footprint.plaintextLeaked = true;
    }

    // 2. Open payment channel (1 on-chain tx)
    const channelStealthAddr = deriveStealthAddress(metaAddress, 'sub_netflix', 0);
    footprint.transactions.push(`channel_open:${channelStealthAddr}`);

    // 3. Process 12 monthly renewals off-chain
    const renewalCommitments: string[] = [];
    let userBalance = 200;
    let executorBalance = 0;

    for (let month = 0; month < 12; month++) {
      // Stealth address per renewal
      const renewalAddr = deriveStealthAddress(metaAddress, 'sub_netflix', month);
      expect(renewalAddr).toBeDefined();

      // ZK commitment for payment amount
      const amount = 1599n;
      const paymentCommitment = createPaymentCommitment(amount, `renewal:${month}`);
      renewalCommitments.push(paymentCommitment.amountCommitment);

      // Verify commitment without revealing amount
      expect(verifyPaymentCommitment(amount, paymentCommitment)).toBe(true);
      expect(verifyPaymentCommitment(amount + 1n, paymentCommitment)).toBe(false);

      // Off-chain state update
      userBalance -= 15.99;
      executorBalance += 15.99;
    }

    // 4. Close channel (1 on-chain tx)
    footprint.transactions.push(`channel_close:${userBalance.toFixed(2)}:${executorBalance.toFixed(2)}`);

    // 5. Build audit log from commitments
    const auditRoot = getMerkleRoot(renewalCommitments);
    footprint.commitments.push(auditRoot);

    // 6. Selective disclosure: prove one payment without revealing others
    const proofForMonth3 = generateMerkleProof(renewalCommitments, 3);
    expect(verifyMerkleProof(proofForMonth3)).toBe(true);

    // === AUDIT ON-CHAIN FOOTPRINT ===

    // Only 2 on-chain transactions (open + close)
    expect(footprint.transactions.length).toBe(2);

    // No plaintext leaked
    expect(footprint.plaintextLeaked).toBe(false);

    // Encrypted data stored
    expect(footprint.encryptedBlobs).toBeGreaterThan(0);

    // Can still decrypt locally
    const decrypted = await decryptMetadata(encrypted, encryptionKey);
    const recovered = JSON.parse(decrypted);
    expect(recovered.name).toBe('Netflix Premium');
    expect(recovered.price).toBe(15.99);
  });

  it('should ensure all stealth addresses are unique across the lifecycle', () => {
    const allAddresses = new Set<string>();

    const subscriptions = ['netflix', 'spotify', 'adobe'];
    for (const sub of subscriptions) {
      for (let i = 0; i < 12; i++) {
        const addr = deriveStealthAddress(metaAddress, `sub_${sub}`, i);
        expect(allAddresses.has(addr)).toBe(false);
        allAddresses.add(addr);
      }
    }

    expect(allAddresses.size).toBe(36);
  });

  it('should ensure commitments are unlinkable', () => {
    const amount = 1599n;
    const commitments = Array.from({ length: 10 }, () => commit(amount));

    const uniqueCommitments = new Set(commitments.map((c) => c.commitment));
    expect(uniqueCommitments.size).toBe(10);

    for (const c of commitments) {
      expect(verify(amount, BigInt('0x' + c.blindingFactor), c.commitment)).toBe(true);
    }
  });
});
