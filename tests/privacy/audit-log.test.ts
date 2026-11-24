import { describe, it, expect } from 'vitest';
import {
  buildMerkleTree,
  getMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
} from '../../shared/src/crypto/merkle';
import { createPaymentCommitment } from '../../shared/src/crypto/payment-commitment';

describe('Privacy Integration: Private Audit Log', () => {
  it('should log events as commitments in a Merkle tree', () => {
    const events = [
      'subscription:created:netflix:2025-01-15',
      'payment:processed:netflix:15.99:2025-02-15',
      'payment:processed:netflix:15.99:2025-03-15',
      'subscription:cancelled:netflix:2025-04-01',
    ];

    const commitments = events.map((event) => {
      const commitment = createPaymentCommitment(BigInt(event.length), event);
      return commitment.amountCommitment;
    });

    const root = getMerkleRoot(commitments);
    expect(root).toBeDefined();
    expect(typeof root).toBe('string');
  });

  it('should generate a Merkle proof for selective disclosure', () => {
    const events = ['event_a', 'event_b', 'event_c', 'event_d'];
    const commitments = events.map((e) =>
      createPaymentCommitment(BigInt(e.length), e).amountCommitment
    );

    const proof = generateMerkleProof(commitments, 1);

    expect(proof.leaf).toBe(commitments[1]);
    expect(proof.path.length).toBeGreaterThan(0);
    expect(proof.root).toBeDefined();
  });

  it('should verify a valid Merkle proof', () => {
    const events = ['event_a', 'event_b', 'event_c', 'event_d'];
    const commitments = events.map((e) =>
      createPaymentCommitment(BigInt(e.length), e).amountCommitment
    );

    const proof = generateMerkleProof(commitments, 2);
    const isValid = verifyMerkleProof(proof);
    expect(isValid).toBe(true);
  });

  it('should reject a tampered Merkle proof', () => {
    const events = ['event_a', 'event_b', 'event_c', 'event_d'];
    const commitments = events.map((e) =>
      createPaymentCommitment(BigInt(e.length), e).amountCommitment
    );

    const proof = generateMerkleProof(commitments, 0);
    const tamperedProof = {
      ...proof,
      leaf: commitments[1],
    };
    const isValid = verifyMerkleProof(tamperedProof);
    expect(isValid).toBe(false);
  });

  it('should support selective disclosure without revealing other events', () => {
    const events = [
      'payment:netflix:15.99',
      'payment:spotify:9.99',
      'payment:adobe:54.99',
      'payment:github:4.00',
    ];

    const commitments = events.map((e) =>
      createPaymentCommitment(BigInt(e.length), e).amountCommitment
    );

    const root = getMerkleRoot(commitments);

    const disclosedIndex = 2;
    const proof = generateMerkleProof(commitments, disclosedIndex);

    expect(verifyMerkleProof(proof)).toBe(true);
    expect(proof.root).toBe(root);

    expect(proof.leaf).toBe(commitments[disclosedIndex]);
    for (let i = 0; i < commitments.length; i++) {
      if (i !== disclosedIndex) {
        expect(proof.leaf).not.toBe(commitments[i]);
      }
    }
  });

  it('should maintain audit log integrity across multiple entries', () => {
    const auditEntries: string[] = [];
    for (let i = 0; i < 16; i++) {
      auditEntries.push(`audit_entry_${i}_${Date.now()}`);
    }

    const commitments = auditEntries.map((e) =>
      createPaymentCommitment(BigInt(e.length), e).amountCommitment
    );

    const tree = buildMerkleTree(commitments);
    expect(tree.length).toBeGreaterThan(1);

    const root = tree[tree.length - 1][0];
    expect(root).toBe(getMerkleRoot(commitments));

    for (let i = 0; i < commitments.length; i++) {
      const proof = generateMerkleProof(commitments, i);
      expect(verifyMerkleProof(proof)).toBe(true);
      expect(proof.root).toBe(root);
    }
  });
});
